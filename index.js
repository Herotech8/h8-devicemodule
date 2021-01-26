const mqtt = require('mqtt');
const UrlPattern = require('url-pattern');
const EventEmitter = require('events');

class MyEmitter extends EventEmitter {}

class ModuleOptions {
  constructor() {
    this.options = {
      hardwareType: null,
      serialNumber: null,
      prefix: null
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

    this.eventBus = new MyEmitter();
  }

  start() {
    var parent = this;

    return new Promise((resolve, reject) => {
      parent.startedAt = new Date().getTime();

      var client = mqtt.connect('mqtt://localhost');

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
        var pattern1 = new UrlPattern(parent.constructTopic('status/request(/:id)'));

        if(pattern1.match(topic)) {
          var params = pattern1.match(topic);

          var status = parent.statusCallback({
            uptime: (new Date().getTime() - parent.startedAt)
          });

          var pubTopic = 'status/response' + (params.id !== undefined ? '/' + params.id : '');

          console.log('MQTT Local', 'Publishing Status');

          client.publish(parent.constructTopic(pubTopic), JSON.stringify(status));
        }

        parent.eventBus.emit('message', topic, message);
      });

      parent.client = client;
    });
  }

  constructTopic(suffix) {
    return this.hardwareType + '/' + this.serialNumber + '/' + this.prefix + '/' + suffix;
  }

  onStatus(callback) {
    this.statusCallback = callback;
  }

  provideService(name, callback) {
    var requestTopic = this.constructTopic(name + '/request(/:id)'),
        responseTopic = this.constructTopic(name + '/response(/:id)');

    this.client.on('message', (topic, message) => {
      var pattern = new UrlPattern(requestTopic);

      if(pattern.match(topic)) {
        var params = pattern.match(topic);

        var response = callback(message);

        var responseTopic = this.constructTopic(name + '/response') + (params.id !== undefined ? '/' + params.id : '');

        var responseMessage = response;

        if(responseMessage.constructor == {}.constructor) {
          responseMessage = JSON.stringify(responseMessage);
        }

        this.client.publish(responseTopic, responseMessage);
      }
    });
  }

  publish(topic, message) {
    this.client.publish(topic, message);
  }
}

module.exports = {
  ModuleOptions: ModuleOptions,
  Module: Module
};
