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

function writeTemplate(outFile, template, templateData) {
  return fs.writeFileSync(outFile, pug.renderFile(templatePath + template, templateData), () => { });
}

function writeStructure(model, key, objectsAndMethods, structures) {
    mkdirp(outputPath + '/structures');
    for (var structure in structures) {
      writeTemplate(outputPath + 'structures/' + structures[structure].value.name + '.html', 'structure.pug', { 
        model: model, 
        object: key, 
        name: structure,
        info: objectsAndMethods[key],
        structure: structures[structure]
      });
    }
}

function writeTemplate2(htmlFilename, template, locals) {
  return fs.writeFileSync(outputPath + htmlFilename, pug.renderFile(templatePath + template, locals), () => { });
}

function processMetaModel(model) {
  var objectsAndMethods = findObjectsAndMethods(model.value.info.packages);

  writeTemplate2(model.value.info.name, 'home.pug', {
    model: model,
    namespace: model.name,
    objects: objectsAndMethods
  });

  writeTemplate2('index.html', 'index.pug', {
    model: model,
    items: components 
  });

  let suffix = path.sep + 'index.html';
  for (var key of Object.keys(objectsAndMethods)) {
    let keyPath = outputPath + path.sep + key;
    mkdirp(keyPath);
    writeTemplate(keyPath + suffix, 'services.pug', { 
      model: model, 
      object: key, 
      info: objectsAndMethods[key], 
      services: objectsAndMethods[key].services 
    });

    writeStructure(model, key, objectsAndMethods, objectsAndMethods[key].structures);
/*    
    var structures = objectsAndMethods[key].structures;
    mkdirp(outPath + '/structures');
    for (var structure in structures) {
      writeTemplate(outPath + '/structures/' + structures[structure].value.name + '.html', tempPath + '/structure.pug', { 
        model: model, 
        object: key, 
        name: structure,
        info: objectsAndMethods[key], 
        structure: objectsAndMethods[key].structures[structure]
      });
    }
*/

    for (var service of Object.keys(objectsAndMethods[key].services)) {
      let servicePath = keyPath + path.sep + service;
      mkdirp(servicePath);
      writeTemplate(servicePath + suffix, 'service.pug', { 
        model: model, 
        object: key, 
        name: service, 
        info: objectsAndMethods[key], 
        service: objectsAndMethods[key].services[service]
      });

      writeStructure(model, key, objectsAndMethods, objectsAndMethods[key].services[service].value.structures);

      var operations = objectsAndMethods[key].services[service].value.operations
      for (var operation of Object.keys(operations)) {
        let operationPath = servicePath + path.sep + operations[operation].key;
        mkdirp(operationPath);
        writeTemplate(operationPath + suffix, 'operation.pug', { 
          model: model, 
          object: key,
          namespace: objectsAndMethods[key].key,
          service: service,
          operation: operation, 
          info: operations[operation]
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
    process.exit(0);
  })
  .parse(process.argv);
