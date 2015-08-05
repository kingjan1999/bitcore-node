'use strict';

var BitcoinNode = require('..').Node;
var chainlib = require('chainlib');
var socketio = require('socket.io');
var log = chainlib.log;
log.debug = function() {};

var configuration = {
  datadir: process.env.BITCORENODE_DIR || '~/.bitcoin',
  network: process.env.BITCORENODE_NETWORK || 'livenet',
  port: 3000
};

var node = new BitcoinNode(configuration);

var count = 0;
var interval;

node.on('ready', function() {

  var io = socketio(configuration.port);

  interval = setInterval(function() {
    log.info('Sync Status: Tip:', node.chain.tip.hash, 'Height:', node.chain.tip.__height, 'Rate:', count/10, 'blocks per second');
    count = 0;
  }, 10000);

  io.on('connection', function(socket) {

    var bus = node.openBus();

    var methods = node.getAllAPIMethods();
    var methodsMap = {};

    methods.forEach(function(data) {
      var name = data[0];
      var instance = data[1];
      var method = data[2];
      var args = data[3];
      methodsMap[name] = {
        fn: function() {
          return method.apply(instance, arguments);
        },
        args: args
      };
    });

    socket.on('message', function(message, socketCallback) {
      if (methodsMap[message.method]) {
        var params = message.params;

        if(!params || !params.length) {
          params = [];
        }

        if(params.length !== methodsMap[message.method].args) {
          return socketCallback({
            error: {
              message: 'Expected ' + methodsMap[message.method].args + ' parameters'
            }
          });
        }

        var callback = function(err, result) {
          var response = {};
          if(err) {
            response.error = {
              message: err.toString()
            };
          }

          if(result) {
            if(result.toJSON) {
              response.result = result.toJSON();
            } else {
              response.result = result;
            }
          }

          socketCallback(response);
        };

        params = params.concat(callback);
        methodsMap[message.method].fn.apply(this, params);
      } else {
        socketCallback({
          error: {
            message: 'Method Not Found'
          }
        });
      }
    });

    socket.on('subscribe', function(name, params) {
      bus.subscribe(name, params);
    });

    socket.on('unsubscribe', function(name, params) {
      bus.unsubscribe(name, params);
    });

    var events = node.getAllPublishEvents();

    events.forEach(function(event) {
      bus.on(event.name, function() {
        if(socket.connected) {
          var results = [];

          for(var i = 0; i < arguments.length; i++) {
            if(arguments[i].toJSON) {
              results.push(arguments[i].toJSON());
            } else {
              results.push(arguments[i]);
            }
          }

          var params = [event.name].concat(results);
          socket.emit.apply(socket, params);
        }
      });
    });

    socket.on('disconnect', function() {
      bus.close();
    });

  });

});

node.on('error', function(err) {
  log.error(err);
});

node.chain.on('addblock', function(block) {
  count++;
});
