var compose = require('@stamp/compose');
var isStamp = require('@stamp/is/stamp');
var isObject = require('@stamp/is/object');
var isArray = require('@stamp/is/array');

function dedupe(array) {
  var result = [];
  for (var i = 0; i < array.length; i++) {
    var item = array[i];
    if (result.indexOf(item) < 0) result.push(item);
  }
  return result;
}

function makeProxyFunction(functions, name) {
  function deferredFn() {
    'use strict';
    for (var i = 0; i < functions.length; i++) {
      functions[i].apply(this, arguments); // jshint ignore:line
    }
  }

  Object.defineProperty(deferredFn, 'name', {
    value: name,
    configurable: true
  });

  return deferredFn;
}

function getCollisionSettings(descriptor) {
  return descriptor &&
    descriptor.deepConfiguration &&
    descriptor.deepConfiguration.Collision;
}

function descriptorHasSetting(descriptor, setting, methodName) {
  var settings = getCollisionSettings(descriptor);
  var settingsFor = settings && settings[setting];
  return isArray(settingsFor) && settingsFor.indexOf(methodName) >= 0;
}

function forbidsCollision(descriptor, methodName) {
  var settings = getCollisionSettings(descriptor);
  if (settings && settings.forbidAll) return true;
  return descriptorHasSetting(descriptor, 'forbid', methodName);
}

function defersCollision(descriptor, methodName) {
  return descriptorHasSetting(descriptor, 'defer', methodName);
}

module.exports = compose({
  deepConfiguration: {Collision: {defer: [], forbid: []}},
  staticProperties: {
    collisionSetup: function (opts) {
      return this.compose({deepConfiguration: {Collision: opts}});
    },
    collisionSettingsReset: function () {
      return this.collisionSetup(null);
    },
    collisionProtectAnyMethod: function () {
      return this.collisionSetup({forbidAll: true});
    }
  },
  composers: [function (opts) {
    var descriptor = opts.stamp.compose;
    var settings = getCollisionSettings(descriptor);
    if (!isObject(settings)) return;

    var i, methodName;
    // Deduping is an important part of the logic
    if (isArray(settings.defer)) {
      settings.defer = dedupe(settings.defer);
    }
    if (isArray(settings.forbid)) {
      settings.forbid = dedupe(settings.forbid);
    }

    // Make sure settings are not ambiguous
    if (isArray(settings.defer) && isArray(settings.forbid)) {
      for (i = 0; i < settings.forbid.length; i++) {
        methodName = settings.forbid[i];
        if (settings.defer.indexOf(methodName) >= 0) {
          throw new Error('Ambiguous Collision settings. The `' + methodName +
            '` is both deferred and forbidden');
        }
      }
    }

    if (settings.forbidAll ||
      isArray(settings.defer) && settings.defer.length > 0 ||
      isArray(settings.forbid) && settings.forbid.length > 0
    ) {
      var d, j, oneMetadata;

      var methodsMetadata = {}; // methods aggregation
      var composables = opts.composables;
      for (i = 0; i < composables.length; i++) {
        d = composables[i];
        d = isStamp(d) ? d.compose : d;
        if (!isObject(d.methods)) continue;

        var methodNames = Object.keys(d.methods);
        for (j = 0; j < methodNames.length; j++) {
          methodName = methodNames[j];
          var method = d.methods[methodName];
          if (!method) continue;

          var existingMetadata = methodsMetadata[methodName];

          // Process Collision.forbid
          if (existingMetadata && forbidsCollision(descriptor, methodName)) {
            throw new Error('Collision of method `' + methodName +
              '` is forbidden');
          }

          // Process Collision.defer
          if (defersCollision(d, methodName)) {
            if (existingMetadata && !isArray(existingMetadata)) {
              throw new Error('Ambiguous Collision settings. The `' +
                methodName + '` is both deferred and regular');
            }
            var arr = existingMetadata || [];
            arr.push(method);
            methodsMetadata[methodName] = arr;
            continue;
          }

          // Process no Collision settings
          if (isArray(existingMetadata)) {
            throw new Error('Ambiguous Collision settings. The `' +
              methodName + '` is both deferred and regular');
          }

          methodsMetadata[methodName] = method;
        }
      }

      var methods = opts.stamp.compose.methods;
      var allMetadataMethods = Object.keys(methodsMetadata);
      for (i = 0; i < allMetadataMethods.length; i++) {
        methodName = allMetadataMethods[i];
        oneMetadata = methodsMetadata[methodName];
        if (isArray(oneMetadata)) {
          if (oneMetadata.length === 1) {
            methods[methodName] = oneMetadata[0];
          } else {
            // Some collisions aggregated to a single method
            // Mutating the resulting stamp
            methods[methodName] = makeProxyFunction(oneMetadata, methodName);
          }
        } else {
          methods[methodName] = oneMetadata;
        }
      }
    }
  }]
});