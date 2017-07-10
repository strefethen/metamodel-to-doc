#!/usr/bin/env node
var os = require('os');
var request = require('sync-request');
var program = require('commander');
const pug = require('pug');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
var showdown  = require('showdown');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const host = 'sc-rdops-vm08-dhcp-239-244.eng.vmware.com';

const metadataPath = '/rest/com/vmware/vapi/metadata/metamodel/component/id:';

// The following list should be fetched from here: https://<host>/rest/com/vmware/vapi/metadata/metamodel/component
const components = [
  // "com.vmware.vcenter.ovf",
  // "applmgmt",
  // "com.vmware.cis",
  // "com.vmware.vcenter.inventory",
   "com.vmware.vcenter",
  // "com.vmware.vapi.vcenter",
  // "com.vmware.cis.tagging",
  // "com.vmware.content",
  // "vmon_vapi_provider",
  // "com.vmware.transfer",
  // "data_service",
  // "com.vmware.vapi.rest.navigation",
  // "com.vmware.vcenter.iso",
  // "com.vmware.vapi",
  // "authz"
];

// Default templates to the current folder
var templatePath = `.${path.sep}templates${path.sep}`;
var outputPath = `.${path.sep}reference${path.sep}`;;

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
    for (var service in pkg.value.services) {
      var serviceName = pkg.value.services[service].key.split('.');
      serviceName = serviceName[serviceName.length - 1];
      objects[name].services[serviceName] = pkg.value.services[service];
    }
    // Create a list of structures
    objects[name].structures = { };
    for (var structure in pkg.value.structures) {
      var structureName = pkg.value.structures[structure].key.split('.');
      structureName = structureName[structureName.length - 1];
      objects[name].structures[structureName] = pkg.value.structures[structure];
    }
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
      locals['name'] = structure;
      writeTemplate('structures', structures[structure].value.name + '.html', 'structure.pug', locals);
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
  console.log(filePath, fileName);
  var destPath = outputPath;
  if (filePath != "") {
    destPath = outputPath + path.sep + filePath;
  }
  mkdirp.sync(destPath);
  var content = pug.renderFile(templatePath + template, locals);
  return fs.writeFileSync(`${destPath}${path.sep}${fileName}.html`, content, (err) => {
    if (err) {
      throw err;
    }
    console.log('File written.');
   });
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

function processMetaModel(model) {
  if (!model.value.info) return;
  var objectsAndMethods = findObjectsAndMethods(model.value.info.packages);
  var re = /\./g

  // root page listing namespaces
  writeTemplate('', 'index', 'index.pug', {
    model: model,
    items: components
  });

  var packages = model.value.info.packages.map(function(pkg) { return pkg; });
  var services = []
  packages.map(function(pkg) { 
    pkg.value.services.map(function(service) {
      services.push(service);
    }); 
  });

  var enums = model.value.info.packages.map(function(item) { return item.value.enumerations});

  // Packages within a namespace
  writeTemplate('', model.value.info.name, 'packages.pug', {
    model: model,
    namespace: model.value.info.name,
    packages: packages,
    services: services,
    objects: objectsAndMethods,
    enums: enums
  });

  for (var i in enums) {
    for (var e in enums[i]) {
      writeTemplate('enumerations', enums[i][e].key + '.html', 'enumeration.pug', { enumeration: enums[i][e], values: enums[i][e].value.values});
    }
  }

  for (var key of Object.keys(objectsAndMethods)) {

    // namespace services pages
    if (objectsAndMethods[key].key === 'com.vmware.cis')
      continue;
    writeTemplate(objectsAndMethods[key].key.replace(re, '/'), 'index', 'services.pug', { 
      object: key.replace(re, '/'), 
      namespace: model.value.info.name,
      documentation: objectsAndMethods[key].value.documentation,
      services: objectsAndMethods[key].services
    });

    // structure pages
    writeStructures(model, key, objectsAndMethods, objectsAndMethods[key].structures, { 
        model: model,
        object: key,
        info: objectsAndMethods[key]
      });

    var examples = null;

    for (var service of Object.keys(objectsAndMethods[key].services)) {
      let servicePath = `${key}${path.sep}${service}`;
      servicePath = objectsAndMethods[key].key.replace(re, '/') + '/' + service;

      // service page
      console.log(`https://raw.githubusercontent.com/strefethen/samples/master/${servicePath}.md`);
      var res = request('GET', `https://raw.githubusercontent.com/strefethen/samples/master/${servicePath}.md`);
      var converter = new showdown.Converter();
      examples = null;
      if (res.statusCode == 200) {
        examples = converter.makeHtml(res.getBody('utf8'));
      }
      writeTemplate(servicePath, 'index', 'service.pug', { 
        model: model,
        object: key, 
        name: service,
        namespace: objectsAndMethods[key].key, 
        documentation: objectsAndMethods[key].services[service].value.documentation, 
        examples: examples,
        structures: objectsAndMethods[key].value.structures,
        constants: objectsAndMethods[key].value.constants,
        service: objectsAndMethods[key].services[service],
        services: objectsAndMethods[key].services
      });

      // service structures
      writeStructures(model, key, objectsAndMethods, objectsAndMethods[key].services[service].value.structure, { 
        model: model, 
        object: key, 
        info: objectsAndMethods[key],
      });

      var operations = objectsAndMethods[key].services[service].value.operations
      for (var operation of Object.keys(operations)) {
        let operationPath = `${servicePath}${path.sep}${operations[operation].key}`;

        console.log(`https://raw.githubusercontent.com/strefethen/samples/master/${operationPath}.md`);
        res = request('GET', `https://raw.githubusercontent.com/strefethen/samples/master/${operationPath}.md`);
        var converter = new showdown.Converter();
        examples = null;
        if (res.statusCode == 200) {
          examples = converter.makeHtml(res.getBody('utf8'));
        }
            
        // operation of a service
        writeTemplate(operationPath, 'index', 'operation.pug', {
          namespace: `${objectsAndMethods[key].key}.${service}`,
          service: service,
          errors: operations[operation].value.errors,
          documentation: operations[operation].value.documentation,
          examples: examples,
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
  .arguments('<host> <output_path> [template_path] [name_space]')
  .action(function(host, output_path, template_path) {
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
    for (var component in components) {
      console.log(`'Processing: ${components[component]}`);
      var res = request('GET', `https://${host}${metadataPath}${components[component]}`);
          console.log('Downloaded.');
          mkdirp(output_path, (err) =>  { 
            if (err) throw err;
            processMetaModel(JSON.parse(res.getBody('utf8')));
          });
    }
    console.log('Done.')
//    process.exit(0);
  })
  .parse(process.argv);
