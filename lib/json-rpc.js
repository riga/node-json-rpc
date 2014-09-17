// node imports
var util = require("util");

// external imports
var through = require("through");


// param check helper
var checkParam = function(name, value, required, type) {
  // check if the value is set
  if (value === undefined) {
    // if it's required, throw an error
    // otherwise, we're fine
    if (required) {
      throw Error("no " + name + " given");
    } else {
      return;
    }
  }

  // check the type
  if (type == "int") {
    if (value !== parseInt(value)) {
      throw Error(name + " must be an integer");
    }
  } else if (type == "array") {
    if (!(value instanceof Array)) {
      throw Error(name + " must be an array");
    }
  }
};


// json-rpc definitions based on http://www.jsonrpc.org/specification
// basically containing functions to create stringified request,
// response and error objects
var specs = module.exports.specs = {

  // error definition
  errors: {
    "-32700": "Parse error",
    "-32600": "Invalid Request",
    "-32601": "Method not found",
    "-32602": "Invalid params",
    "-32603": "Internal error",
    "-32000": "Server error"
  },

  // returns a stringified request
  request: function(method, id, params, encoded) {
    checkParam("method", method, true);
    checkParam("id", id, false, "int");

    // create the beginning of the request
    var req = util.format('{"jsonrpc":"2.0","method":"%s"', method);

    // add id and params to the request
    if (id != null) {
      req += ',"id":' + id;
    }
    if (params != null) {
      req += ',"params":' + (!encoded ? JSON.stringify(params) : params);
    }

    // close and return the request
    return req + "}";
  },

  // returns a stringified response
  response: function(id, result, encoded) {
    checkParam("id", id, true, "int");
    checkParam("result", result, true);

    // create and return the response
    var tmpl = '{"jsonrpc":"2.0","id":%s,"result":%s}';
    return util.format(tmpl, id, (!encoded ? JSON.stringify(result) : result));
  },

  // returns a stringified error
  error: function(id, code, message, data, encoded) {
    checkParam("id", id, true, "int");
    checkParam("code", code, true, "int");
    checkParam("message", message, true);

    // create the beginning of the error
    var tmpl = '{"jsonrpc":"2.0","id":%s,"error":{"code":%s,"message":"%s"';
    var err = util.format(tmpl, id, code, message);

    // add data
    if (data != null) {
      err += ',"data":' + (!encoded ? JSON.stringify(data) : data);
    }

    // close and return the error
    return err + "}}";
  }
};


// definition of the rpc object
// target is an object to wrap
var rpc = module.exports.rpc = function(target) {
  var stream, callbacks = {}, counter = 0;

  //
  // define handlers for requests, responses and errors
  //

  // responses
  var handleResponse = function(res) {
    // lookup the callback for res.id and call it with res.result and
    // an leadaing empty error
    if (res.id && callbacks[res.id]) {
      // invoke the callback
      callbacks[res.id].apply(null, [null].concat(res.result));

      // delete the callback
      delete callbacks[res.id];
    }
  };

  // errors
  var handleError = function(err) {
    // look up the callback for err.id, create an error instance
    // and pass it to the callback
    if (err.id && callbacks[err.id]) {
      // create the error instance
      var msg = util.format("%s (%s)", err.error.message, err.error.code);
      var _err = new Error(msg);
      _err.code = err.error.code;
      _err.data = err.error.data;

      // invoke the callback
      callbacks[err.id](_err);

      // delete the callback
      delete callbacks[err.id];
    }
  };

  // requests
  var handleRequest = function(req) {
    // to perform a request, a target is required
    if (!target) {
      return;
    }

    // try to route the request
    try {
      var callback = function(err) {
        if (err) {
          throw err;
        }
        var res = Array.prototype.slice.call(arguments, 1);
        if (req.id) {
          stream.emit("data", specs.response(req.id, res) + "\n");
        }
      };
      evalRoute(req.method, req.params, callback);
    } catch (err) {
      if (req.id) {
        err = specs.error(req.id, err.code, err.message, err.data);
        stream.emit("data", err + "\n");
      }
    }
  };

  // routing helper used be the request handler
  // the method can contain period characters that are
  // interpreted as object notation
  var evalRoute = function(route, params, callback) {
    try {
      // resolve object notation
      var _target = target;
      var parts = route.split(".");
      while (parts.length > 1) {
        var part = parts.shift();
        if (_target[part]) {
          _target = _target[part];
        } else {
          break;
        }
      }

      // fetch the actual function to call 
      var fn = _target[parts[0]];
      if (!(fn instanceof Function)) {
        // the route does not point to a function
        throw {
          code   : -32601,
          message: specs.errors["-32601"],
          data   : null
        }
      } else {
        // the route points to a valid function
        params = params || [];
        params.push(callback);

        fn.apply(_target, params);
      }
    } catch (err) {
      throw {
        code   : -32603,
        message: specs.errors["-32603"],
        data   : null
      }
    }
  };

  // define the stream
  stream = through(function(data) {
    data = JSON.parse(String(data));

    // simply dispatch to our handlers depending on specific keys
    if ("method" in data) {
      // request
      handleRequest(data);
    } else if ("result" in data) {
      // response
      handleResponse(data);
    } else if ("error" in data) {
      // error
      handleError(data);
    }
  });

  // invoke a remote function to be called
  // params MUST be array
  // set encoded to true if params is already json encoded
  var invoke = function(route, params, callback, encoded) {
    // there may be no params but a callback
    if (params instanceof Function) {
      encdoded = callback;
      callback = params;
      params = null;
    }

    // check if params is an array or undefined
    checkParam("params", params || undefined, false, "array");

    // save the callback if any
    if (callback instanceof Function) {
      callbacks[++counter] = callback;
    }

    // create and perform the request
    var id = (callback instanceof Function) ? counter : undefined;
    var req = specs.request(route, id, params, encoded);
    stream.emit("data", req + "\n");

    // reset the counter if needed (unlikely)
    if (callback && counter == Number.MAX_VALUE) {
      counter = 0;
    }

    return stream;
  };

  var wrap = function(route, keys) {
    // handle arguments
    if (keys === undefined) {
      keys = route;
      route = null;
    }

    // check keys
    checkParam("keys", keys, true, "array");

    // create a wrapper
    wrapper = {};

    // add functions to the wrapper based on invoke
    keys.forEach(function(key) {
      wrapper[key] = function() {
        var args = Array.prototype.slice.call(arguments);

        // the last argument might be a callback
        var cb = null;
        if (args[args.length-1] instanceof Function) {
          cb = args.pop();
        }

        if (route) {
          key = route + "." + key;
        }

        invoke(key, args, cb);

        return this;
      };
    });

    return wrapper;
  };

  // add the functions to the stream
  stream.invoke = invoke;
  stream.wrap = wrap;

  return stream;
};
