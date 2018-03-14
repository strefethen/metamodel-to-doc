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

// REST Spec URLs
const url_structure = "https://confluence.eng.vmware.com/pages/viewpage.action?spaceKey=Standards&title=REST#url-structure";

const annotationRegex = /{@[a-z]* ([\.,#,A-Za-z]*)}/g;
const inpageLinkRegex = /#([a-z]*) [a-z]*/g;

const examplesUrl = 'https://raw.githubusercontent.com/strefethen/samples/master/';
const metadataPath = '/rest/com/vmware/vapi/metadata/metamodel/component';

// Default templates to the current folder
var templatePath = `.${path.sep}templates${path.sep}`;
var outputPath = `.${path.sep}reference${path.sep}`;;
var includeExamples = true;

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

/**
 * Consumes meta model data and reorganizes it so it can be a bit easier to use in a template.
 * @param {Array} packages - list of packages to process ex: ["com.vmware.vapi", "com.vmware.vcenter"]
 */
function findObjectsAndMethods(packages) {
  var objects = {};
  packages.forEach((pkg) => {
    var splitPath = pkg.key.split('.');
    var name = splitPath[splitPath.length - 1];
    objects[name] = pkg;
    // Create a list of services
    objects[name].services = { };
    objects[name].structures = { };
    objects[name].enumerations = { };

    // Create a list of structures
    for (var structure in pkg.value.structures) {
      var structureName = pkg.value.structures[structure].key.split('.');
      structureName = structureName[structureName.length - 1];
      objects[name].structures[structureName] = pkg.value.structures[structure];
    }
    pkg.value.services.forEach((service) => {
      var serviceName = service.key.split('.');
      serviceName = serviceName[serviceName.length - 1];
      objects[name].services[serviceName] = service;
      service.value.structures.map(function (structure) {
        objects[name].structures[structure.value.name] = structure;
      });
      service.value.enumerations.map(function (e) {
        objects[name].enumerations[e.value.name] = e;
      });
    });
    if (Object.keys(objects[name].structures).length == 0) {
      delete objects[name].structures;
    }
  });
  for (var p in packages) {
    var splitPath = packages[p].key.split('.');
    objects[splitPath[splitPath.length - 1]] = packages[p];
  }
  return objects;
}

function writeStructures(model, key, objectsAndMethods, structures, locals) {
  for (var structure in structures) {
    writeTemplate('structures', structures[structure].value.name, 'structure.pug', {
      structure: structures[structure],
      documentation: structures[structure].value.documentation.replace(annotationRegex, '$1'),
      name: structure,
      regex: annotationRegex
    });
    structureCount++;
    structureTotal++;
  }
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
  var destPath = outputPath;
  if (filePath != "") {
    destPath = `${outputPath}${path.sep}${filePath}`;
  }
  if (!fs.existsSync(destPath)) {
    mkdirp.sync(destPath);
  }
  locals["pretty"] = true;
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

function processMetaModel(component) {
  if (!component.value.info) return;
  console.log('Component: ', component.value.info.name);

  deleteOperationCount = 0;
  putOperationCount = 0;
  getOperationCount = 0;
  postOperationCount = 0;
  putOperationCount = 0;
  unknownOperationVerbCount = 0;

  var objectsAndMethods = findObjectsAndMethods(component.value.info.packages);
  var re = /\./g

  var packages = component.value.info.packages;
  
  //  console.log(packages);
  var services = [];
  var structures = [];
  var enums = [];
  
  packages.map(function(pkg) { 
    pkg.value.structures.map(function(structure) {
      structures.push(structure);
    }); 
    pkg.value.enumerations.map(function(e) {
      enums.push(e);
    });
    pkg.value.services.map(function(service) {
      service.value.structures.map(function(structure) {
        structures.push(structure);
      });
      service.value.enumerations.map(function(e) {
        enums.push(e);
      });
      services.push(service);
    }); 
  });

  // Packages within a component
  writeTemplate('', component.value.info.name, 'component.pug', {
    documentation: component.value.info.documentation.replace(annotationRegex, '$1'),
    model: component,
    namespace: component.value.info.name,
    packages: packages,
    services: services,
    structures: structures,
    enums: enums
  });

  enums.map((e) => {
    writeTemplate('enumerations', e.key, 'enumeration.pug', { enumeration: e});
    enumCount++;
  })

  for (var key of Object.keys(objectsAndMethods)) {

    if (key == "cis" && component.value.info.name != "com.vmware.cis")
      continue;

    // namespace services pages
    writeTemplate(objectsAndMethods[key].key.replace(re, '/'), 'index', 'services.pug', { 
      components: components,
      component: objectsAndMethods[key].key,
      object: key.replace(re, '/'), 
      namespace: component.value.info.name,
      documentation: objectsAndMethods[key].value.documentation,//.replace(annotationRegex, '$1'),
      services: objectsAndMethods[key].services,
      structures: objectsAndMethods[key].structures,
      enumerations: objectsAndMethods[key].enumerations
    });

    structureCount = 0;
    
    // structure pages
    writeStructures(component, key, objectsAndMethods, objectsAndMethods[key].structures, { 
        model: component,
        object: key,
        info: objectsAndMethods[key]
    });

    console.log("\tServices:")
    for (var service of Object.keys(objectsAndMethods[key].services)) {
      console.log("\t\t", service);
      let servicePath = `${key}${path.sep}${service}`;
      servicePath = objectsAndMethods[key].key.replace(re, '/') + '/' + service;

      let listWarning = checkListWarning(serviceSupportsListAndNotGet(objectsAndMethods[key].services[service]));

      // service page
      writeTemplate(servicePath, 'index', 'service.pug', { 
        model: component,
        object: key, 
        pluralwarning: checkPluralWarning(serviceSupportsListAndIsNotPlural(objectsAndMethods[key].services[service])),
        url_structure: url_structure,
        listwarning: listWarning,
        name: service,
        namespace: objectsAndMethods[key].key, 
        documentation: objectsAndMethods[key].services[service].value.documentation, //.replace(annotationRegex, '$1'), 
        examples: getExamples(servicePath),
        structures: objectsAndMethods[key].value.structures,
        constants: objectsAndMethods[key].value.constants,
        service: objectsAndMethods[key].services[service],
        services: objectsAndMethods[key].services
      });

      // service structures
      writeStructures(component, key, objectsAndMethods, objectsAndMethods[key].services[service].value.structure, { 
        model: component, 
        object: key, 
        info: objectsAndMethods[key],
      });

      var operations = objectsAndMethods[key].services[service].value.operations;
      for (var operation of Object.keys(operations)) {
        let operationPath = `${servicePath}${path.sep}${operations[operation].key}`;
        let method = findRequestMapping(operations[operation].value.metadata);

        // operation of a service
        writeTemplate(operationPath, 'index', 'operation.pug', {
          regex: annotationRegex,
          requestWarning: checkRequestWarning(service, method, objectsAndMethods[key].key, operations[operation].value.name),
          listWarning: listWarning,
          warning: checkValueTypeWarning(!isValidType(operations[operation].value.output.type)),
          namespace: `${objectsAndMethods[key].key}.${service}`,
          service: service,
          errors: operations[operation].value.errors,
          documentation: operations[operation].value.documentation.replace(annotationRegex, '$1'),
          examples: getExamples(operationPath),
          operation: operations[operation],
          operations: operations,
          params: operations[operation].value.params,
          output: operations[operation].value.output,
          method: method
        });
        switch (method.method) {
          case "PUT":
            putOperationCount++;
            putOperationTotal++;
            break;
          case "GET":
            getOperationCount++;
            getOperationTotal++;
            break;
          case "POST":
            postOperationCount++;
            postOperationTotal++;
            break;
          case "PATCH":
            patchOperationCount++;
            patchOperationTotal++;
            break;
          case "DELETE":
            deleteOperationCount++;
            deleteOperationTotal++;
            break;
          default:
            if(method.method) {
              console.log(method.method);
            }
            unknownOperationVerbCount++;
            unknownOperationVerbTotal++;
            break;
        }
      }
    }
    if(program.showStats) {
      console.log("\tGET count         : ", getOperationCount);
      console.log("\tDELETE count      : ", deleteOperationCount);
      console.log("\tPUT count         : ", putOperationCount);
      console.log("\tPOST count        : ", postOperationCount);
      console.log("\tPATCH count       : ", patchOperationCount);
      console.log("\tUnknown Verb count: ", unknownOperationVerbCount);
      console.log("\tStructure count   : ", structureCount);        
    }
  }
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
  var res = request('GET', `https://${host}${metadataPath}/id:${components[component]}`);
  if (res.statusCode == 200) {
    console.log('Downloaded.');
    mkdirp.sync(program.output_path);
    processMetaModel(JSON.parse(res.getBody('utf8')));
  } else {
    console.log(chalk.red(`Error: ${res.statusCode}`));
  }
}

if(program.showStats || program.showCount) {
  console.log("API Totals:");
  console.log("GET count         : ", getOperationTotal);
  console.log("DELETE count      : ", deleteOperationTotal);
  console.log("PUT count         : ", putOperationTotal);
  console.log("POST count        : ", postOperationTotal);
  console.log("PATCH count       : ", patchOperationTotal);
  console.log("Unknown Verb count: ", unknownOperationVerbTotal);
  console.log("Structure count   : ", structureTotal);
}
console.log('Done.');
process.exit(0);
