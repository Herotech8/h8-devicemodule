const UrlPattern = require('url-pattern');
const uniqid = require('uniqid');

class MqttServices {
  constructor(mqttClient, options) {
    this.mqttClient = mqttClient;
    this.options = options;
  }

  constructTopic(suffix) {
    return this.options.hardwareType + '/' + this.options.serialNumber + '/' + this.options.prefix + '/' + suffix;
  }

  request(name, params, timeout = 5000) {
    return new Promise((resolve, reject) => {
      var isResolved = false,
          requestId = uniqid(),
          requestTopic = name + '/request/' + requestId,
          responseTopic = name + '/response/' + requestId;

      var messageCallback = (topic, message) => {
        if(topic != responseTopic) {
          return;
        }

        if(isResolved) {
          return;
        }

        isResolved = true;

        message = message.toString();

        try {
          message = JSON.parse(message);
        } catch(err) {
          //
        }

        resolve(message);
      };

      this.mqttClient.on('message', messageCallback);

      this.mqttClient.subscribe(responseTopic);

      var message = params;

      try {
        message = JSON.stringify(message);
      } catch(err) {
        //
      }

      this.mqttClient.publish(requestTopic, message);

      setTimeout(() => {
        if(isResolved) {
          return;
        }

        isResolved = true;

        reject('Timeout');
      }, timeout);
    });
  }

  provide(name, callback) {
    var requestTopic = this.constructTopic(name + '/request(/:id)'),
        responseTopic = this.constructTopic(name + '/response(/:id)');

    if(name == null || name == '') {
      requestTopic = this.constructTopic('request(/:id)');
      responseTopic = this.constructTopic('response(/:id)');
    }

    this.mqttClient.on('message', (topic, message) => {
      var pattern = new UrlPattern(requestTopic);

      if(pattern.match(topic)) {
        var params = pattern.match(topic);

        var update = (topic, message) => {
          if(name == null || name == '') {
            topic = this.constructTopic(topic) + (params.id !== undefined ? '/' + params.id : '');
          } else {
            topic = this.constructTopic(name + '/' + topic) + (params.id !== undefined ? '/' + params.id : '');
          }

          this.mqttClient.publish(topic, message);
        };

        new Promise((resolve, reject) => {
          callback(message, resolve, update);
        }).then((responseMessage) => {
          var responseTopic = this.constructTopic(name + '/response') + (params.id !== undefined ? '/' + params.id : '');

          if(name == null || name == '') {
            responseTopic = this.constructTopic('response') + (params.id !== undefined ? '/' + params.id : '');
          }

          if(responseMessage.constructor == {}.constructor) {
            responseMessage = JSON.stringify(responseMessage);
          }

          if(responseMessage.constructor == [].constructor) {
            responseMessage = JSON.stringify(responseMessage);
          }

          this.mqttClient.publish(responseTopic, responseMessage);
        }).catch((err) => {
          console.error('Error in service', err);
        });
      }
    });
  }
}

module.exports = MqttServices;
