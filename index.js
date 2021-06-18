const mqtt = require('mqtt');
const UrlPattern = require('url-pattern');
const EventEmitter = require('events');
const MqttServices = require('./lib/MqttServices.js');
const Config = require('h8-config');

class MyEmitter extends EventEmitter {}

class ModuleOptions {
  constructor() {
    this.options = {
      hardwareType: null,
      serialNumber: null,
      prefix: null,
      mqttHost: 'mqtt://localhost'
    };
  }

  set(key, value) {
    if(this.options[key] === undefined) {
      throw "Invalid key provided (" + key + ")";
    }

    if(value === undefined) {
      throw "Invalid value provided, undefined (" + key + ")";
    }

    this.options[key] = value;
  }

  get(key) {
    if(this.options[key] === undefined) {
      throw "Invalid key requested (" + key + ")";
    }

    return this.options[key];
  }
}

class Module {
  constructor(options) {
    if(!options instanceof ModuleOptions) {
      throw "Options must be passed";
    }

    this.prefix = options.get('prefix');
    this.hardwareType = options.get('hardwareType');
    this.serialNumber = options.get('serialNumber');
    this.statusCallback = (status) => { return status; };
    this.mqttHost = options.get('mqttHost');

    this.eventBus = new MyEmitter();

    this.Config = Config;
  }

  start() {
    var parent = this;

    return new Promise((resolve, reject) => {
      parent.startedAt = null;

      var startedAtCounter = 0, startedAtOffset = 0;

      var startedAtInterval = setInterval(() => {
        startedAtCounter += 1;
        startedAtOffset += 500;

        if(new Date().getTime() > 1609459200000) {
          parent.startedAt = (new Date().getTime() - startedAtOffset);
          clearInterval(startedAtInterval);
          console.log('Device Module', 'Timestamp Obtained', startedAtCounter, startedAtOffset);
        } else {
          if(startedAtCounter >= 10) {
            clearInterval(startedAtInterval);
          }
        }
      }, 500);


      var client = mqtt.connect(this.mqttHost);

      client.on('connect', () => {
        console.log('MQTT Local', 'Connected');

        client.publish(parent.hardwareType + '/' + parent.serialNumber + '/register-module', JSON.stringify({
          module: parent.prefix
        }));

        client.subscribe(parent.constructTopic('#'));

        console.log('MQTT Local', 'Subscribed To', parent.constructTopic('#'));

        resolve();
      });

      client.on('message', (topic, message) => {
        //console.log('MQTT Local', 'Received', topic, message.toString());

        var pattern1 = new UrlPattern(parent.constructTopic('state/request(/:id)'));

        if(pattern1.match(topic)) {
          var params = pattern1.match(topic);

          var suffix = 'response' + (params.id !== undefined ? '/' + params.id : '');

          parent.publishState(suffix);
          parent.publishState();

//           var status = parent.statusCallback({
//             uptime: (parent.startedAt !== null ? (new Date().getTime() - parent.startedAt) : null)
//           });

//           var pubTopic = 'state/response' + (params.id !== undefined ? '/' + params.id : '');

//           pubTopic = parent.constructTopic(pubTopic);

//           console.log('MQTT Local', 'Publishing Status');

//           client.publish(pubTopic, JSON.stringify(status));
        }

        parent.eventBus.emit('message', topic, message);
      });

      parent.client = client;

      parent.MqttServices = new MqttServices(client, {
        prefix: this.prefix,
        hardwareType: this.hardwareType,
        serialNumber: this.serialNumber
      });
    });
  }

  static mqtt() {
    return new Promise((resolve, reject) => {
      console.log('[DeviceModule]', 'Setting up MQTT client');

      var client  = mqtt.connect('mqtt://localhost', {
        port: 1883
      });

      client.on('connect', function () {
        console.log('[DeviceModule]', 'MQTT client connected');

        resolve(client);
      });
    });
  }

  constructTopic(suffix) {
    return this.hardwareType + '/' + this.serialNumber + '/' + this.prefix + '/' + suffix;
  }

  onStatus(callback) {
    this.statusCallback = callback;
  }

  onState(callback) {
    this.statusCallback = callback;
  }

  provideService(name, callback) {
    var requestTopic = this.constructTopic(name + '/request(/:id)'),
        responseTopic = this.constructTopic(name + '/response(/:id)');

    this.client.on('message', (topic, message) => {
      var pattern = new UrlPattern(requestTopic);

      if(pattern.match(topic)) {
        var params = pattern.match(topic);

        callback(message).then((responseMessage) => {
          var responseTopic = this.constructTopic(name + '/response') + (params.id !== undefined ? '/' + params.id : '');

          if(responseMessage.constructor == {}.constructor) {
            responseMessage = JSON.stringify(responseMessage);
          }

          this.client.publish(responseTopic, responseMessage);
        }).catch((err) => {
          console.error('Error in service', err);
        });
      }
    });
  }

  publish(topic, message, unfiltered) {
    if(unfiltered === undefined || !unfiltered) {
      topic = this.constructTopic(topic);
    }

    this.client.publish(topic, message);
  }

  publishState(suffix) {
    var status = this.statusCallback({
      uptime: (this.startedAt !== null ? (new Date().getTime() - this.startedAt) : null)
    });

    var pubTopic = 'state';

    if(suffix !== undefined) {
      pubTopic += '/' + suffix
    }

    pubTopic = this.constructTopic(pubTopic);

    console.log('MQTT Local', 'Publishing Status');

    this.client.publish(pubTopic, JSON.stringify(status));
  }

    variable(name, getCb, setCb) {
    console.log('[MODULE]', '[VARIABLE]', 'Setup', name);

    var publish = this.hardwareType + '/' + this.serialNumber + '/' + this.prefix + '/' + name,
        getPattern = this.hardwareType + '/:serialNumber/' + this.prefix + '/' + name + '/get',
        setPattern = this.hardwareType + '/:serialNumber/' + this.prefix + '/' + name + '/set';

    if(name === null) {
      publish = this.hardwareType + '/' + this.serialNumber + '/' + this.prefix;
      getPattern = this.hardwareType + '/:serialNumber/' + this.prefix + '/get';
      setPattern = this.hardwareType + '/:serialNumber/' + this.prefix + '/set';
    }

    this.client.on('message', (topic, message) => {
      if(new UrlPattern(getPattern).match(topic)) {
        console.log('[MODULE]', '[VARIABLE]', '[GET]', 'New Request');

        new Promise(getCb).then((response) => {
          try {
            if(response.constructor == [].constructor || response.constructor == {}.constructor) {
              response = JSON.stringify(response);
            }
          } catch(err) {
            console.error('[MODULE]', '[VARIABLE]', '[GET]', 'Request Invalid JSON');
          }

          console.error('[MODULE]', '[VARIABLE]', '[GET]', 'Service Resolved');

          this.client.publish(publish, '' + response);
        }).catch((err) => {
          console.error('[MODULE]', '[VARIABLE]', '[GET]', 'Service Error', err);
        });
      } else if(new UrlPattern(setPattern).match(topic)) {
        console.log('[MODULE]', '[VARIABLE]', '[SET]', 'New Request', message.toString());

        message = message.toString();

        try {
          var json = JSON.parse(message);

          if(json.constructor == [].constructor || json.constructor == {}.constructor) {
            message = json;
          } else {
            throw "Invalid JSON";
          }
        } catch(err) {
          console.error('[MODULE]', '[VARIABLE]', '[SET]', 'Request Invalid JSON');
        }

        new Promise((resolve, reject) => {
          setCb(message, resolve, reject);
        }).then((response) => {
          try {
            if(response.constructor == [].constructor || response.constructor == {}.constructor) {
              response = JSON.stringify(response);
            }
          } catch(err) {
            console.error('[MODULE]', '[VARIABLE]', '[SET]', 'Response Invalid JSON');
          }

          console.error('[MODULE]', '[VARIABLE]', '[SET]', 'Service Resolved');

          this.client.publish(publish, '' + response);
        }).catch((err) => {
          console.error('[MODULE]', '[VARIABLE]', '[SET]', 'Service Error', err);
        });
      }
    });
  }
}

module.exports = {
  ModuleOptions: ModuleOptions,
  Module: Module
};
