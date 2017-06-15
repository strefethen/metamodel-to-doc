#!/usr/bin/env node
var request = require('superagent');
var program = require('commander');
const pug = require('pug');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');

const components = [
  "com.vmware.vcenter.ovf",
  "applmgmt",
  "com.vmware.cis",
//  "com.vmware.vcenter.inventory",
  "com.vmware.vcenter",
  "com.vmware.vapi.vcenter",
//  "com.vmware.cis.tagging",
  "com.vmware.content",
//  "vmon_vapi_provider",
//  "com.vmware.transfer",
//  "data_service",
//  "com.vmware.vapi.rest.navigation",
//  "com.vmware.vcenter.iso",
  "com.vmware.vapi",
//  "authz"
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
  for (var p in packages) {
    var splitpath = packages[p].key.split('.');
    var name = splitpath[splitpath.length - 1];
    objects[name] = packages[p];
    // Create a list of services
    objects[name].services = { };
    for (var service in packages[p].value.services) {
      var serviceName = packages[p].value.services[service].key.split('.');
      serviceName = serviceName[serviceName.length - 1];
      objects[name].services[serviceName] = packages[p].value.services[service];
    }
    // Create a list of structures
    objects[name].structures = { };
    for (var structure in packages[p].value.structures) {
      var structureName = packages[p].value.structures[structure].key.split('.');
      structureName = structureName[structureName.length - 1];
      objects[name].structures[structureName] = packages[p].value.structures[structure];
    }
  }
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
function writeTemplate(filePath, filename, template, locals) {
  var destPath = outputPath + path.sep;
  if (filePath != "") {
    destPath = outputPath + path.sep + filePath + path.sep;
  }
  mkdirp(destPath);
  return fs.writeFileSync(`${destPath}${filename}.html`, pug.renderFile(templatePath + template, locals), () => { });
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
  var objectsAndMethods = findObjectsAndMethods(model.value.info.packages);

  writeTemplate('', model.value.info.name, 'home.pug', {
    model: model,
    namespace: model.name,
    objects: objectsAndMethods
  });

  writeTemplate('', 'index', 'index.pug', {
    model: model,
    items: components
  });

  for (var key of Object.keys(objectsAndMethods)) {

    writeTemplate(key, 'index', 'services.pug', { 
      object: key, 
      namespace: model.value.info.name,
      services: objectsAndMethods[key].services
    });

    writeStructures(model, key, objectsAndMethods, objectsAndMethods[key].structures, { 
        model: model,
        object: key,
        info: objectsAndMethods[key]
      });

    for (var service of Object.keys(objectsAndMethods[key].services)) {
      let servicePath = `${key}${path.sep}${service}`;
      mkdirp(servicePath);
      writeTemplate(servicePath, 'index', 'service.pug', { 
        model: model,
        object: key, 
        name: service,
        namespace: objectsAndMethods[key].key, 
        documentation: objectsAndMethods[key].value.metadata.documentation, 
        structures: objectsAndMethods[key].value.structures,
        constants: objectsAndMethods[key].value.constants,
        service: objectsAndMethods[key].services[service]
      });

      writeStructures(model, key, objectsAndMethods, objectsAndMethods[key].services[service].value.structure, { 
        model: model, 
        object: key, 
        info: objectsAndMethods[key],
      });

      var operations = objectsAndMethods[key].services[service].value.operations
      for (var operation of Object.keys(operations)) {
        let operationPath = `${servicePath}${path.sep}${operations[operation].key}`;
        writeTemplate(operationPath, 'index', 'operation.pug', {
          namespace: objectsAndMethods[key].key,
          service: service,
          errors: operations[operation].value.errors,
          documentation: operations[operation].value.documentation,
          operation: operations[operation],
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
  .arguments('<swagger_url> <output_path> [template_path]')
  .action(function(swagger_url, output_path, template_path) {
    if (template_path) {
      templatePath = template_path;
    }
    if (output_path) {
      outputPath = output_path;
    }
    console.log('Output Path: '+ output_path);
    console.log('Processing swagger file: ', swagger_url);
    if (swagger_url.startsWith('http')) {
      request
        .get(swagger_url)
        .end(function (err, res) {
          console.log('Downloaded.')
          mkdirp(output_path);
          processMetaModel(res.body);
        })
    } else {
      var data = fs.readFileSync(swagger_url, 'utf8');
      mkdirp(output_path);
      processMetaModel(JSON.parse(data));
    }
    console.log('Done.')
    process.exit(0);
  })
  .parse(process.argv);
