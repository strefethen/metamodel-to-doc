#!/usr/bin/env node
var request = require('superagent');
var program = require('commander');
const pug = require('pug');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');

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
  return fs.writeFileSync(outFile, pug.renderFile(template, templateData), () => { });
}

function processMetaModel(model, outPath, tempPath) {
  var objectsAndMethods = findObjectsAndMethods(model.value.info.packages);

  writeTemplate(outPath + path.sep + model.value.info.name + '.html', tempPath + '/home.pug', {
    model: model,
    objects: objectsAndMethods
  });

  let suffix = path.sep + 'index.html';
  for (var key of Object.keys(objectsAndMethods)) {
    let keyPath = outPath + path.sep + key;
    mkdirp(keyPath);
    writeTemplate(keyPath + suffix, tempPath + '/services.pug', { 
      model: model, 
      object: key, 
      info: objectsAndMethods[key], 
      services: objectsAndMethods[key].services 
    });

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

    for (var service of Object.keys(objectsAndMethods[key].services)) {
      let servicePath = keyPath + path.sep + service;
      mkdirp(servicePath);
      writeTemplate(servicePath + suffix, tempPath + '/service.pug', { 
        model: model, 
        object: key, 
        name: service, 
        info: objectsAndMethods[key], 
        service: objectsAndMethods[key].services[service]
      });

      var operations = objectsAndMethods[key].services[service].value.operations
      for (var operation of Object.keys(operations)) {
        let operationPath = servicePath + path.sep + operations[operation].key;
        mkdirp(operationPath);
        writeTemplate(operationPath + suffix, tempPath + '/operation.pug', { 
          model: model, 
          object: key,
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
  .arguments('<swagger_url> <output_path> <template_path>')
  .action(function(swagger_url, output_path, template_path) {
    console.log('Output Path: '+ output_path);
    console.log('Processing swagger file: ', swagger_url);
    if (swagger_url.startsWith('http')) {
      request
        .get(swagger_url)
        .end(function (err, res) {
          console.log('Downloaded.')
          mkdirp(output_path);
          processMetaModel(res.body, output_path, template_path);
        })
    } else {
      var data = fs.readFileSync(swagger_url, 'utf8');
      mkdirp(output_path);
      processMetaModel(JSON.parse(data), output_path, template_path);
    }
    process.exit(0);
  })
  .parse(process.argv);
