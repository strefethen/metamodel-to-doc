#!/usr/bin/env node
const os = require('os');
const request = require('sync-request');
const program = require('commander');
const chalk = require('chalk');
const pug = require('pug');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const showdown  = require('showdown');
// const mustache = require('mustache');

// https://10.160.171.160/rest/com/vmware/vapi/metadata/metamodel/component/id:com.vmware.vcenter.guest
// https://10.160.171.160/rest/com/vmware/vapi/metadata/metamodel/package/id:com.vmware.vcenter.guest
// https://10.160.171.160/rest/com/vmware/vapi/metadata/metamodel/service/id:com.vmware.vcenter.guest.customization_specs
// https://10.160.171.160/rest/com/vmware/vapi/metadata/metamodel/service/operation/id:com.vmware.vcenter.guest.customization_specs/id:list

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Warning types
let warnings = {
  "list": 0,
  "request": 0,
  "wrapper": 0,
  "plural": 0
}

// Info to pass to templates to render versions dropdown
let vsphereVersions = [
  "main",
  "cloud",
  "layer1",
  "v6.7.1",
  "v6.7.0",
  "v6.5.2"
];

// List of components that can be skipped since they don't include public API's
let nonPublicComponents = [
  "data_service", 
  "vapi_common", 
  "vmon_vapi_provider", 
  "vcenter_api", 
  "vcenter_cis_api", 
  //"com.vmware.vapi", 
  "com.vmware.vapi.vcenter", 
  "com.vmware.vapi.rest.navigation"
];

let apis = { }
let testbed = null;
let testbedTime = '';
let host = '';
let warningMsgs = [];

// List of internal API's discovered
let internalApis = [];

let constantTotal = 0;
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

function logWarning(warning) {
  if (program.showWarnings) {
    console.log(chalk.yellow(warning.warning));
  }
  warningMsgs.push(warning);
}

function checkListWarning(warning, service, path) {
  if (warning) {
    let listWarning = { warning: `Warning: Service (${service}) supports a "list" operation but "get" is not implemented leaving no way to fetch a single item from the returned list.`,
                        path: path };
    logWarning(listWarning);
    warnings["list"] = warnings["list"] + 1;
    return listWarning;
  }
  return null;
}

function checkPluralWarning(warning, service, path) {
  if (warning) {
    let pluralWarning = { warning: `Warning: Service (${service.key}) supports a "list" but is not plural.`,
                          path: path };
    logWarning(pluralWarning);
    warnings["plural"] = warnings["plural"] + 1;
    return pluralWarning;
  }
  return null;
}

function checkValueTypeWarning(valueType, operationPath) {
  if (valueType) {
    let warning = { warning: `Warning: "value" wrapper is not an object nor an array of objects. Path: ${operationPath} Value Type: ${JSON.stringify(valueType)}.`,
                    path: operationPath };
    logWarning(warning);
    warnings["wrapper"] = warnings["wrapper"] + 1;
    return warning;
  }
  return null;
}

function checkRequestWarning(service, method, key, name, path) {
  if (Object.keys(method).length === 0 && method.constructor === Object) {
    let requestWarning = { warning: `Warning: Operation (${service.key}.${name}) missing @RequestMapping. (${service.key}/${name})`,
                           path: path };
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
  locals.vsphereVersions = vsphereVersions;
  locals.root = program.output_path.split("/").pop();
  locals.testbed = testbed;
  locals.testbedTime = testbedTime;
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
  if (program.examples) {
    console.log('Path: ', path);
    let res = request('GET', `${examplesUrl}${path}.md`);
    let converter = new showdown.Converter();
    if (res.statusCode == 200) {
      return converter.makeHtml(res.getBody('utf8'));
    }
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

function writeOperation(component, pkg, service, key, operation, servicePath, serviceInternal) {
  let operationPath = `${servicePath}${path.sep}${key}`;
  let listWarning = checkListWarning(serviceSupportsListAndNotGet(service), service.key, operationPath);
  let method = findRequestMapping(operation.metadata);
  apis[component.value.info.name][pkg.key].services[service.key].operations.push({ operation: operation.name, path: operationPath, internal: serviceInternal });
//  console.log(mustache.render('function {{operation.name}}({{params}}): {{output}}', { operation: operation, params: operation.params, output: operation.output.type}));
  writeTemplate(operationPath, 'index', 'operation.pug', {
    package: pkg,
    component: component,
    regex: annotationRegex,
    requestWarning: checkRequestWarning(service, method, key, operation.name, operationPath),
    listWarning: listWarning,
    warning: checkValueTypeWarning(!isValidType(operation.output.type), servicePath + '/' + operation.name),
    namespace: `${service.key}`,
    service: service.key,
    errors: operation.errors,
    documentation: operation.documentation.replace(annotationRegex, '$1'),
    examples: getExamples(operationPath),
    operation: operation.name,
    operations: service.value.operations.sort((a, b) => { return a.key.localeCompare(b.key) }),
    params: operation.params,
    output: operation.output,
    method: method,
    internal: serviceInternal
  });

  // If the Operation is missing a RequestMapping annotation then the following table "attempts" to provide the proper HTTP verb mapping
  if (!method.method) {
    switch (operation.name) {
      case "get":
      case "list":
      case "stats":
      case "fingerprint":
      case "progress":
      case "list_attachable_tags":
      case "list_attached_tags":
      case "list_attached_objects":
      case "list_attached_objects_on_tags":
      case "list_all_attached_objects_on_tags":
      case "list_attached_tags_on_objects":
      case "list_detail":
      case "query_detail":
      case "list_used_categories":
      case "list_tags_for_category":
      case "list_tags_for_categories":
      case "list_used_tags":
      case "find":
      case "probe":
      case "preview":
      case "get_by_datastore_path":
      case "get_datastore_path":
      case "get_item_state":
      case "get_item_states":
      case "query":
      case "batch_has_privileges":
      case "has_privileges":
      case "batch_query":
      case "find_tags_by_name":
      case "get_all_categories":
      case "get_all_tags":
      case "get_categories":
      case "get_tags":
        method["method"] = "GET";
        break;      
      case "set":
        method["method"] = "PUT";
        break;
        case "create":
      case "add":
      case "add_to_used_by":
      case "attach":
      case "copy":
      case "detach":
      case "reload":
      case "attach_tag_to_multiple_objects":
      case "detach_tag_from_multiple_objects":
      case "attach_multiple_tags_to_object":
      case "detach_multiple_tags_from_object":
      case "release_session":
      case "remove_item_targets":
      case "filter":
      case "remove_items":
      case "renew_session":
      case "set_item_source":
      case "add_item_targets":
      case "add_items":
      case "create_session":
      case "cancel":
      case "complete":
      case "enable":
      case "hash":
      case "limits":
      case "mount":
      case "unmount":
      case "disable":
      case "fail":
      case "keep_alive":
      case "remove":
      case "test":
      case "evict":
      case "validate":
      case "sync":
      case "deploy":
      case "prepare":
      case "create_for_resource_pool":
      case "create_probe_import_session":
      case "try_instantiate":
      case "deploy":
      case "instantiate":
      case "remove_from_used_by":
      case "revoke_propagating_permissions":
      case "update":
      case "login":
      case "logout":
        method["method"] = "POST"
        break;
      case "complete":
        method["method"] = "POST"
        break;
      case "delete":
        method["method"] = "DELETE"
        break;
      default:
        logWarning("WARN: Undetermined method:", operation.name);
    }
  }
  if (serviceInternal) {
    internalApis.push({ path: operationPath, name: `${service.key}.${operation.name}`});
  } else {
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
          logWarning(`WARN unknown HTTP verb: ${method.method}`);
        }
        unknownOperationVerbTotal++;
    }
  }
}

function writeOperations(component, pkg, service, operations, servicePath, serviceInternal) {
  for(var operation in operations) {
    writeOperation(component, pkg, service, operations[operation].key, operations[operation].value, servicePath, serviceInternal);
  }
}

function findMetadataValue(metadata, key) {
  if(metadata.length != 0) {
    let value = metadata.map(item => {
      if(item.key == key) {
        return item.value.elements[0].value;
      } else { 
        return null;
      }
    });
    for (var i = 0; i < value.length; i++) {
      if (value[i] != null)
        return value[i]
    }
  }
  return null; 
}

function findVersionInfo(metadata) {
  let released = findMetadataValue(metadata, "Released");
  if (released) {
    return released;
  }
  return null;
}

function isInternal(metadata) {
  let internal = findMetadataValue(metadata, "Internal");
  if (internal) {
    return internal.string_value === "true";
  }
  return false;
}

function writeService(component, pkg, key, services, service) {
  var re = /\./g;
  let servicePath = key.replace(re, '/');
  let listWarning = checkListWarning(serviceSupportsListAndNotGet(service), service.key, servicePath);
  let internal = isInternal(service.value.metadata);
  apis[component.value.info.name][pkg.key].services[service.key] = { 
    path: servicePath,
    operations: [],
    internal: internal
  };
  writeTemplate(servicePath, 'index', 'service.pug', { 
    model: component,
    object: key, 
    pluralwarning: checkPluralWarning(serviceSupportsListAndIsNotPlural(service), service, servicePath),
    url_structure: url_structure,
    listwarning: listWarning,
    name: service.key.split('.').pop(),
    namespace: service.key, 
    documentation: service.value.documentation, //.replace(annotationRegex, '$1'), 
    examples: getExamples(servicePath),
    structures: service.value.structures,
    // TODO: Figure out how to render constants
    constants: service.value.constants.sort((a, b) => { return a.key.localeCompare(b.key) }),
    internal: internal,
    service: service,
    operations: service.value.operations.sort((a, b) => { return a.key.localeCompare(b.key) }),
    services: services,
    versions: findVersionInfo(service.value.metadata)
  });
  writeOperations(component, pkg, service, service.value.operations, servicePath, internal);
}

function writeServices(component, pkg, services, components) {
  services.sort((a, b) => { return a.key.localeCompare(b.key) });
  for(var service in services) {
    console.log('\t\tService:', services[service].key);
    if (!program.raw && services[service].key.startsWith("com.vmware.cis") && component.value.info.name === "com.vmware.cis")
      continue;
    writeService(component, pkg, services[service].key, services, services[service])
    writeConstants(component, pkg, services[service].value.constants);
    writeEnumerations(component, pkg, services[service].value.enumerations);
    writeStructures(component, pkg, services[service].value.structures);
  }
  var re = /\./g;
  let packages = component.value.info.packages.sort((a, b) => { return a.key.localeCompare(b.key) });

  writeTemplate(pkg.key.replace(re, '/'), 'index', 'services.pug', { 
    components: components,
    component: pkg.key,
    object: pkg.key, 
    namespace: component.value.info.name,
    documentation: pkg.value.documentation,//.replace(annotationRegex, '$1'),
    services: services,
    isInternal: isInternal,
    structures: pkg.value.structures.sort((a, b) => { return a.key.localeCompare(b.key) }),
    enumerations: pkg.value.enumerations.sort((a, b) => { return a.key.localeCompare(b.key) }),
    packages: packages,
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

function writeConstant(component, pkg, constant) {
  writeTemplate('constants', constant.key, 'constant.pug', {
    constant: constant,
    documentation: constant.value.documentation.replace(annotationRegex, '$1'),
    name: constant.key,
    regex: annotationRegex
  });
  constantTotal++;
}

function writeConstants(component, pkg, constants) {
  for(var constant in constants) {
    writeConstant(component, pkg, constants[constant]);    
  }
}

function writePackage(component, pkg, components) {
  console.log('\tPackage: ',pkg.key);
  var re = /\./g;
  apis[component.value.info.name][pkg.key] = { services: [], enumerations: [], structures: [], path: pkg.key.replace(re, '/') };
  if (pkg.value.services.length == 0 && pkg.value.enumerations.length == 0 && pkg.value.structures.length == 0) {
    logWarning(`Package: ${pkg.key} has no services, enumerations, or structures.`);
  }  
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
  return items.sort((a, b) => { return a.key.localeCompare(b.key) });
}

function findServiceIndex(services, service) {
  for (var i = 0; i < services.length; i++) {
    if (services[i].key == service)
      return i;
  }
  return -1;
}

function findPackageIndex(packages, pkgName) {
  for (var i = 0; i < packages.length; i++) {
    if (packages[i].key == pkgName)
      return i;
  }
  return -1;
}

/**
 * For each package in component generates static documentation for each element, all structures
 * and a page for the details of the component itself.
 * @param {object} component - vAPI Component object
 * @param {Array} components - array of Component names
 */
function writeComponent(component, components) {
  // Packages within a component
  console.log('Component: ', component.value.info.name);
  apis[component.value.info.name] = { };
  let packageInfo = {};
  let packageCount = 0;
  let structures = findComponentItems(component, 'structures');
  let packages = component.value.info.packages.sort((a, b) => { return a.key.localeCompare(b.key) });
  let services = findComponentItems(component, 'services');

  // Clean up component messiness unless we're using "-r"
  for(var pkg in component.value.info.packages) {
    // HACK: prevent from overwriting com.vmware.cis component info because it's repeated in this component
    if (program.raw || (component.value.info.name == "com.vmware.cis" && component.value.info.packages[pkg].key == "com.vmware.cis" ||
        component.value.info.name != "com.vmware.cis" && component.value.info.packages[pkg].key !== "com.vmware.cis")) {
      packageInfo[pkg] = writePackage(component, component.value.info.packages[pkg], components);
      packageCount++;
    }
  }  
  if (packageCount == 0) 
    return;

  // Clean up mistaken references to com.vmware.cis package
  if (component.value.info.name != "com.vmware.cis") {
    let idx = findPackageIndex(packages, "com.vmware.cis");
    if (idx != -1) {
      remove(packages, idx);
    }

    idx = findServiceIndex(services, "com.vmware.cis.session");
    if (idx != -1) {
      remove(services, idx);
    }
  }

  writeTemplate('', component.value.info.name, 'component.pug', {
    documentation: component.value.info.documentation.replace(annotationRegex, '$1'),
    model: component,
    components: components,
    component: component,
    namespace: component.value.info.name,
    packages: component.value.info.packages.sort((a, b) => { return a.key.localeCompare(b.key) }),
    services: services,
    structures: structures.sort((a, b) => { return a.key.localeCompare(b.key) }),
    enums: findComponentItems(component, 'enumerations'),
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
  .option('-i, --internal', 'include internal APIs')
  .option('-r, --raw', 'use raw metadata')
  .option('-e, --examples', 'fetch examples from github')
  .option('-v, --verbose', 'verbose output')  
  .parse(process.argv);

try {
  console.log(chalk.bold(`Fetching ${program.testbed} testbed...`));
  let res = request('GET', 'http://10.132.99.217/peek');
  testbed = JSON.parse(res.getBody('utf8'))[program.testbed][0];
  host = testbed.vc[0].systemPNID;
  let buildnum = testbed.VC_BUILD.split('/').pop();
  res = request('GET', `https://buildapi.eng.vmware.com/ob/build/${buildnum}?_format=json`);
  testbedTime = JSON.parse(res.getBody('utf8')).endtime;
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

// Array Remove - By John Resig (MIT Licensed)
function remove(arr, from, to) {
  var rest = arr.slice((to || from) + 1 || this.length);
  arr.length = from < 0 ? arr.length + from : from;
  return arr.push.apply(arr, rest);
}

components.sort((a, b) => { return a.localeCompare(b) });

if (!program.internal) {
  let i = components.length;
  while(i >= 0) {
    //if (components[i] != "com.vmware.content")
    if (nonPublicComponents.includes(components[i]))
      remove(components, i);
    i--;
  }
}

for (var component in components) {
  console.log(`Processing: ${components[component]}`);
  let metadataUrl = `https://${host}${metadataPath}/id:${components[component]}`
  console.log(metadataUrl);
  var res = request('GET', metadataUrl);
  if (res.statusCode == 200) {
    console.log('Downloaded.');
    mkdirp.sync(program.output_path);
    writeComponent(JSON.parse(res.getBody('utf8')), components);
  } else {
    console.log(chalk.red(`Error: ${res.statusCode}`));
  }
}

// root page listing namespaces
writeTemplate('', 'index', 'index.pug', {
  items: components.sort((a, b) => { return a.localeCompare(b) }),
  stats: {
    structureTotal: structureTotal,         
    getOperationTotal: getOperationTotal,
    postOperationTotal: postOperationTotal,
    putOperationTotal: putOperationTotal,
    unknownOperationVerbTotal: unknownOperationVerbTotal,
    deleteOperationTotal: deleteOperationTotal,
    patchOperationTotal: patchOperationTotal,
    enumTotal: enumTotal,
    warnings: warningMsgs,
    internal: internalApis.length,
    apiTotal: getOperationTotal + deleteOperationTotal + putOperationTotal + postOperationTotal + patchOperationTotal
  }
});

writeTemplate('', 'warnings', 'warnings.pug', { warnings: warningMsgs });
writeTemplate('', 'internal', 'internal.pug', { apis: internalApis });
writeTemplate('', 'apiindex', 'apiindex.pug', { apis: apis });

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
  console.log("Constants    : ", constantTotal);  
  console.log("Internal     : ", internalApis.length);
  console.log("Total public APIs: ", getOperationTotal + deleteOperationTotal + putOperationTotal + postOperationTotal + patchOperationTotal);
}
console.log('Done.');
process.exit(0);
