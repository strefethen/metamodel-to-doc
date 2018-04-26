#!/usr/bin/env node
const os = require('os');
const request = require('sync-request');
const program = require('commander');
const chalk = require('chalk');
const pug = require('pug');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
var showdown  = require('showdown');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let warnings = {
  "list": 0,
  "request": 0,
  "wrapper": 0,
  "plural": 0
}

let enumCount = 0;
let structureCount = 0;
let getOperationCount = 0;
let postOperationCount = 0;
let putOperationCount = 0;
let unknownOperationVerbCount = 0;
let deleteOperationCount = 0;
let patchOperationCount = 0;

let structureTotal = 0;
let getOperationTotal = 0;
let postOperationTotal = 0;
let putOperationTotal = 0;
let unknownOperationVerbTotal = 0;
let deleteOperationTotal = 0;
let patchOperationTotal = 0;
let enumTotal = 0;

// REST Spec URLs
const url_structure = "https://confluence.eng.vmware.com/pages/viewpage.action?spaceKey=Standards&title=REST#url-structure";

const annotationRegex = /{@[a-z]* ([\.,#,A-Za-z]*)}/g;
const inpageLinkRegex = /#([a-z]*) [a-z]*/g;

const examplesUrl = 'https://raw.githubusercontent.com/strefethen/samples/master/';
const metadataPath = '/rest/com/vmware/vapi/metadata/metamodel/component';

// Default templates to the current folder
var templatePath = `.${path.sep}templates${path.sep}`;
var outputPath = `.${path.sep}reference${path.sep}`;;
var includeExamples = false;

function logWarning(warning) {
  if (program.showWarnings) {
    console.log(chalk.yellow(warning));
  }
}

function checkListWarning(service) {
  if (service) {
    let listWarning = `Warning: Service (${service}} supports a "list" operation but "get" is not implemented leaving no way to fetch a single item from the returned list.`;
    logWarning(listWarning);
    warnings["list"] = warnings["list"] + 1;
    return listWarning;
  }
  return null;
}

function checkPluralWarning(service) {
  if (service) {
    let pluralWarning = `Warning: Service supports a "list" but is not plural.`;
    logWarning(pluralWarning);
    warnings["plural"] = warnings["plural"] + 1;
    return pluralWarning;
  }
  return null;
}

function checkValueTypeWarning(valueType, operationPath) {
  if (valueType) {
    let warning = `Type Warning: "value" wrapper is not an object nor an array of objects.`
    logWarning(`Warning: "value" wrapper is not an object nor an array of objects. Path: ${operationPath} Value Type: ${JSON.stringify(valueType)}.`);
    warnings["wrapper"] = warnings["wrapper"] + 1;
    return warning;
  }
  return null;
}

function checkRequestWarning(service, method, key, name) {
  if (Object.keys(method).length === 0 && method.constructor === Object) {
    let requestWarning = `Warning: Missing @RequestMapping. (${key}.${service}.${name})`;
    logWarning(requestWarning);
    return requestWarning;
  }
  return null;
}

function isUpperCase(str) {
  return str === str.toUpperCase();
}

/**
 * Attempts to create a path that add "_" to distinguish between paths that are the same name but differ in case.
 * @param {string} urlPath 
 */
function correctUrl(urlPath) {
  if(urlPath != "") {
    var newPath = urlPath.split("/").map((path) => {
      return isUpperCase(path) ? path + "_" : path;
      });
    return newPath.join("/");
  } 
  return urlPath; 
}

/**
 * Writes an html file for the given template passing in locals as data
 * @param {string} path - path relative to outputPath where the file should go
 * @param {string} filename - name of the html file to output (without the extension)
 * @param {string} template - name of the template to use
 * @param {dict} locals - data to pass to the template
 */
function writeTemplate(filePath, fileName, template, locals) {
  //console.log(`Path: ${filePath}/${fileName}.html`);
  if(filePath != "") {
    var newPath = filePath.split("/").map((path) => {
      return isUpperCase(path) ? path.toUpperCase() : path;
      });
    filePath = newPath.join("/");
  }  
  var destPath = outputPath;
  if (filePath != "") {
    destPath = `${outputPath}${path.sep}${filePath}`;
  }
  if (!fs.existsSync(destPath)) {
    mkdirp.sync(destPath);
  }
  locals.pretty = true;
  locals.correctUrl = correctUrl;
  locals.root = program.output_path.split("/").pop();
  var html = pug.renderFile(`${templatePath}${template}`, locals);
// Code to prevent overwriting files that already exist.
//    if (fs.existsSync(`${destPath}${path.sep}${fileName}.html`)) {
//      console.log(`File already exists: ${destPath}${path.sep}${fileName}.html`);
//      return;
//    }
  fs.writeFileSync(`${destPath}${path.sep}${fileName}.html`, html);
}

/**
 * Within an operations metadata dict looks for the RequestMapping and returns it
 * @param {dict} metadata - operations[operation].value.metadata
 */
function findRequestMapping(metadata) {
  var method = {};
  for (var data in metadata) {
    if (metadata[data].key == 'RequestMapping') {
      var elements = metadata[data].value.elements;
      for (var e in elements) {
        if (elements[e].key == "method") {
          method["method"] = elements[e].value.string_value;
        }
        if (elements[e].key == "value") {
          method["path"] = elements[e].value.string_value;
        }
      }
    }
  }
  return method;
}

/**
 * Fetches (if any), API examples from github in markdown and returns HTML
 * @param {string} path - location of example file within examplesUrl repo
 */
function getExamples(path) {
  return null;
  if (!includeExamples) return null;
  console.log('Path: ', path);
  var res = request('GET', `${examplesUrl}${path}.md`);
  var converter = new showdown.Converter();
  if (res.statusCode == 200) {
    return converter.makeHtml(res.getBody('utf8'));
  }
  return null;
}

function isObjectList(obj_type) {
  return obj_type.hasOwnProperty("category") && 
    obj_type.category == "GENERIC" && 
    obj_type.generic_instantiation.generic_type == "LIST" && 
    isValidType(obj_type.generic_instantiation.element_type);
}

function isVoid(obj_type) {
  return obj_type.hasOwnProperty("builtin_type") && obj_type.builtin_type == "VOID";
}

function isUserDefinedType(obj_type) {
  return obj_type.hasOwnProperty("user_defined_type") && 
    obj_type.user_defined_type.hasOwnProperty("resource_type") && 
    obj_type.user_defined_type.resource_type == "com.vmware.vapi.structure";
}

function isValidType(obj_type) {
  return isUserDefinedType(obj_type) || isVoid(obj_type) || isObjectList(obj_type);
}

function isListItem(element) {
  return element.key == "list";
}

function isGetItem(element) {
  return element.key == "get";
}

function serviceSupportsListAndNotGet(service) {
  return service.value.operations.find(isListItem) && !service.value.operations.find(isGetItem);
}

function serviceSupportsListAndIsNotPlural(service) {
  return service.value.operations.find(isListItem) && !service.value.name.endsWith("s");
}

function writeOperation(component, pkg, service, key, operation, servicePath) {
  let listWarning = checkListWarning(serviceSupportsListAndNotGet(service));
  let operationPath = `${servicePath}${path.sep}${key}`;
  let method = findRequestMapping(operation.metadata);
  writeTemplate(operationPath, 'index', 'operation.pug', {
    regex: annotationRegex,
    requestWarning: checkRequestWarning(service, method, key, operation.name),
    listWarning: listWarning,
    warning: checkValueTypeWarning(!isValidType(operation.output.type)),
    namespace: `${service.key}`,
    service: service.key,
    errors: operation.errors,
    documentation: operation.documentation.replace(annotationRegex, '$1'),
    examples: getExamples(operationPath),
    operation: operation.name,
    operations: service.value.operations,
    params: operation.params,
    output: operation.output,
    method: method
  });
  switch (method.method) {
    case "PUT":
      putOperationTotal++;
      break;
    case "GET":
      getOperationTotal++;
      break;
    case "POST":
      postOperationTotal++;
      break;
    case "PATCH":
      patchOperationTotal++;
      break;
    case "DELETE":
      deleteOperationTotal++;
      break;
    default:
      if(method.method) {
        console.log(method.method);
      }
      unknownOperationVerbTotal++;
  }
}

function writeOperations(component, pkg, service, operations, servicePath) {
  for(var operation in operations) {
    writeOperation(component, pkg, service, operations[operation].key, operations[operation].value, servicePath);
  }
}

function findVersionInfo(metadata) {
  if(metadata.length != 0) {
    return metadata.map(item => {
      if(item.key == "Released") {
        return item.value.elements[0].value;
      }
    })[0];
  }
  return null;
}

function writeService(component, pkg, key, services, service) {
  var re = /\./g;
  let servicePath = key.replace(re, '/');
  let listWarning = checkListWarning(serviceSupportsListAndNotGet(service));
  writeTemplate(servicePath, 'index', 'service.pug', { 
    model: component,
    object: key, 
    pluralwarning: checkPluralWarning(serviceSupportsListAndIsNotPlural(service)),
    url_structure: url_structure,
    listwarning: listWarning,
    name: service.key.split('.').pop(),
    namespace: service.key, 
    documentation: service.value.documentation, //.replace(annotationRegex, '$1'), 
    examples: getExamples(servicePath),
    structures: service.value.structures,
    // TODO: Figure out how to render constants
    constants: [],
    service: service,
    services: services,
    versions: findVersionInfo(service.value.metadata)
  });
  writeOperations(component, pkg, service, service.value.operations, servicePath);
}

function writeServices(component, pkg, services, components) {
  for(var service in services) {
    console.log(services[service].key);
    if (services[service].key.startsWith("com.vmware.cis") && component.value.info.name != "com.vmware.cis")
      continue;
    writeService(component, pkg, services[service].key, services, services[service])
    writeConstants(component, pkg, services[service].value.constants);
    writeEnumerations(component, pkg, services[service].value.enumerations);
    writeStructures(component, pkg, services[service].value.structures);
  }
  var re = /\./g;
  writeTemplate(pkg.key.replace(re, '/'), 'index', 'services.pug', { 
    components: components,
    component: pkg.key,
    object: pkg.key.replace(re, '/'), 
    namespace: component.value.info.name,
    documentation: pkg.value.documentation,//.replace(annotationRegex, '$1'),
    services: pkg.value.services,
    structures: pkg.value.structures,
    enumerations: pkg.value.enumerations,
    packages: component.value.info.packages,
    package: pkg
  });
}

function writeEnum(e) {
  writeTemplate('enumerations', e.key, 'enumeration.pug', { enumeration: e}); 
  enumTotal++;
}

function writeEnumerations(component, pkg, enums) {
  for(var e in enums) {
    writeEnum(enums[e]);
  }
}

function writeStructure(component, pkg, structure) {
  writeTemplate('structures', structure.value.name, 'structure.pug', {
    structure: structure,
    documentation: structure.value.documentation.replace(annotationRegex, '$1'),
    name: structure.value.name,
    regex: annotationRegex
  });
  structureTotal++;
}

function writeStructures(component, pkg, structures) {
  for(var structure in structures) {
    writeStructure(component, pkg, structures[structure]);    
  }
}

function writeConstants(constants) {
//  console.log(constants);
}

function writePackage(component, pkg, components) {
  writeServices(component, pkg, pkg.value.services, components);
  writeEnumerations(component, pkg, pkg.value.enumerations);
  writeStructures(component, pkg, pkg.value.structures);
}

function findComponentItems(component, name) {
  let items = [];
  component.value.info.packages.map(pkg => {
    pkg.value[name].map(item => {
      items.push(item);
    });
  });
  return items;
}

/**
 * For each package in component generates static documentation for each element, all structures
 * and a page for the details of the component itself.
 * @param {object} component - vAPI Component object
 * @param {Array} components - array of Component names
 */
function writeComponent(component, components) {
  // Packages within a component
  let packageInfo = {};
  for(var pkg in component.value.info.packages) {
    packageInfo[pkg] = writePackage(component, component.value.info.packages[pkg], components);
  }
  let structures = findComponentItems(component, 'structures');
  writeTemplate('', component.value.info.name, 'component.pug', {
    documentation: component.value.info.documentation.replace(annotationRegex, '$1'),
    model: component,
    namespace: component.value.info.name,
    packages: component.value.info.packages,
    services: findComponentItems(component, 'services'),
    structures: structures,
    enums: findComponentItems(component, 'enumerations')
  });
}

program
  .version('0.0.1')
  .option('-t, --testbed <testbed>', 'testbed', 'layer1')
  .option('-o, --output_path <output_path>', 'output path, defaults to ./reference/', outputPath)
  .option('-p, --template_path <template_path>', 'template path, defaults to ./templates/', templatePath)
  .option('-w, --showWarnings', 'show warnings')
  .option('-s, --showStats', 'show statistics')
  .option('-c, --showCount', 'show API Counts')
  .parse(process.argv);

try {
  console.log(chalk.bold(`Fetching ${program.testbed} testbed...`));
  var res = request('GET', 'http://10.132.99.217:8080/peek');
  var body = JSON.parse(res.getBody('utf8'));
  var host = body[program.testbed][0].vc[0].systemPNID;
  console.log('Fetching metadata...');
  res = request('GET', `https://${host}${metadataPath}`);
  body = JSON.parse(res.getBody('utf8'));
  var components = body.value;
} catch(err) {
  console.log(err);
  process.exit(1);
}
    
if (program.template_path) {
  templatePath = program.template_path;
}
if (program.output_path) {
  outputPath = program.output_path;
  if (program.output_path.startsWith('~')) {
    outputPath = program.output_path.replace('~', os.homedir());
  }
}

console.log('Output Path: '+ program.output_path);

// root page listing namespaces
writeTemplate('', 'index', 'index.pug', {
  items: components
});

for (var component in components) {
  console.log(`Processing: ${components[component]}`);
  let metadata = `https://${host}${metadataPath}/id:${components[component]}`
  console.log(metadata);
  var res = request('GET', metadata);
  if (res.statusCode == 200) {
    console.log('Downloaded.');
    mkdirp.sync(program.output_path);
    writeComponent(JSON.parse(res.getBody('utf8')), components);
  } else {
    console.log(chalk.red(`Error: ${res.statusCode}`));
  }
}

if(program.showStats || program.showCount) {
  console.log("API Totals:");
  console.log("GET count    : ", getOperationTotal);
  console.log("DELETE count : ", deleteOperationTotal);
  console.log("PUT count    : ", putOperationTotal);
  console.log("POST count   : ", postOperationTotal);
  console.log("PATCH count  : ", patchOperationTotal);
  console.log("Unknown Verbs: ", unknownOperationVerbTotal);
  console.log("Structures   : ", structureTotal);
  console.log("Enumerations : ", enumTotal);  
  console.log("Total APIs   : ", getOperationTotal + deleteOperationTotal + putOperationTotal + postOperationTotal + patchOperationTotal);
}
console.log('Done.');
process.exit(0);
