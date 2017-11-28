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

const annotationRegex = /{@[a-z]* ([\.,#,A-Za-z]*)}/g;
const inpageLinkRegex = /#([a-z]*) [a-z]*/g;

const examplesUrl = 'https://raw.githubusercontent.com/strefethen/samples/master/';
const metadataPath = '/rest/com/vmware/vapi/metadata/metamodel/component';

// The following list should be fetched from here: https://<host>/rest/com/vmware/vapi/metadata/metamodel/component

try {
  console.log(chalk.bold('Fetching Layer 1 testbed...'));
  var res = request('GET', 'http://10.132.99.217:8080/peek');
  var body = JSON.parse(res.getBody('utf8'));
  var host = body.layer1[0].vc[0].systemPNID;
  console.log('Fetching metadata...');
  res = request('GET', `https://${host}${metadataPath}`);
  body = JSON.parse(res.getBody('utf8'));
  var components = body.value;
} catch(err) {
  console.log(err);
  process.exit(1);
}

// Default templates to the current folder
var templatePath = `.${path.sep}templates${path.sep}`;
var outputPath = `.${path.sep}reference${path.sep}`;;
var includeExamples = false;

/**
 * Consumes meta model data and reoganizes it so it can be a bit easier to use in a template.
 * @param {Array} packages - list of packages to process ex: ["com.vmware.vapi", "com.vmware.vcenter"]
 */
function findObjectsAndMethods(packages) {
  var objects = {};
  packages.forEach((pkg) => {
    var splitpath = pkg.key.split('.');
    var name = splitpath[splitpath.length - 1];
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
    var splitpath = packages[p].key.split('.');
    objects[splitpath[splitpath.length - 1]] = packages[p];
  }
  return objects;
}

function writeStructures(model, key, objectsAndMethods, structures, locals) {
    for (var structure in structures) {
      locals['structure'] = structures[structure];
      locals['documentation'] = structures[structure].value.documentation.replace(annotationRegex, '$1');
      locals['name'] = structure;
      writeTemplate('structures', structures[structure].value.name, 'structure.pug', locals);
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
  console.log(`Path: ${filePath}/${fileName}.html`);
  var destPath = outputPath;
  if (filePath != "") {
    destPath = `${outputPath}${path.sep}${filePath}`;
  }
  if (!fs.existsSync(destPath)) {
    mkdirp.sync(destPath);
  }
  var html = pug.renderFile(`${templatePath}${template}`, locals);
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

function processMetaModel(component) {
  if (!component.value.info) return;
  var objectsAndMethods = findObjectsAndMethods(component.value.info.packages);
  var re = /\./g

  var packages = component.value.info.packages.map(function(pkg) { 
    if (pkg != 'com.vmware.cis') 
      return pkg;
  });
  console.log(packages);
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
    model: component,
    namespace: component.value.info.name,
    packages: packages,
    services: services,
    structures: structures,
    enums: enums
  });

  enums.map((e) => {
    writeTemplate('enumerations', e.key, 'enumeration.pug', { enumeration: e});
  })

  for (var key of Object.keys(objectsAndMethods)) {

    // namespace services pages
    writeTemplate(objectsAndMethods[key].key.replace(re, '/'), 'index', 'services.pug', { 
      components: components,
      component: objectsAndMethods[key].key,
      object: key.replace(re, '/'), 
      namespace: component.value.info.name,
      documentation: objectsAndMethods[key].value.documentation.replace(annotationRegex, '$1'),
      services: objectsAndMethods[key].services,
      structures: objectsAndMethods[key].structures,
      enumerations: objectsAndMethods[key].enumerations
    });

    // structure pages
    writeStructures(component, key, objectsAndMethods, objectsAndMethods[key].structures, { 
        model: component,
        object: key,
        info: objectsAndMethods[key]
    });

    for (var service of Object.keys(objectsAndMethods[key].services)) {
      let servicePath = `${key}${path.sep}${service}`;
      servicePath = objectsAndMethods[key].key.replace(re, '/') + '/' + service;

      // service page
      writeTemplate(servicePath, 'index', 'service.pug', { 
        model: component,
        object: key, 
        name: service,
        namespace: objectsAndMethods[key].key, 
        documentation: objectsAndMethods[key].services[service].value.documentation.replace(annotationRegex, '$1'), 
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

      var operations = objectsAndMethods[key].services[service].value.operations
      for (var operation of Object.keys(operations)) {
        let operationPath = `${servicePath}${path.sep}${operations[operation].key}`;

        // operation of a service
        writeTemplate(operationPath, 'index', 'operation.pug', {
          namespace: `${objectsAndMethods[key].key}.${service}`,
          service: service,
          errors: operations[operation].value.errors,
          documentation: operations[operation].value.documentation.replace(annotationRegex, '$1'),
          examples: getExamples(operationPath),
          operation: operations[operation],
          operations: operations,
          params: operations[operation].value.params,
          output: operations[operation].value.output,
          method: findRequestMapping(operations[operation].value.metadata)
        });
      }
    }
  }
}

program
  .version('0.0.1')
  .arguments('<output_path> [template_path] [name_space]')
  .action(function(output_path, template_path) {
    if (template_path) {
      templatePath = template_path;
    }
    if (output_path) {
      outputPath = output_path;
      if (output_path.startsWith('~')) {
        outputPath = output_path.replace('~', os.homedir());
      }
    }
    console.log('Output Path: '+ output_path);
    // root page listing namespaces
    writeTemplate('', 'index', 'index.pug', {
      items: components
    });
    for (var component in components) {
      console.log(`'Processing: ${components[component]}`);
      var res = request('GET', `https://${host}${metadataPath}/id:${components[component]}`);
      if (res.statusCode == 200) {
        console.log('Downloaded.');
        mkdirp.sync(output_path);
        processMetaModel(JSON.parse(res.getBody('utf8')));
      } else {
        console.log(chalk.red(`Error: ${res.statusCode}`));
      }
    }
    console.log('Done.')
//    process.exit(0);
  })
  .parse(process.argv);
