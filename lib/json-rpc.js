var util = require('util');
var through = require('through');

var jsonrpc = {
    errors: {
        '-32700': 'Parse error',
        '-32600': 'Invalid Request',
        '-32601': 'Method not found',
        '-32602': 'Invalid params',
        '-32603': 'Internal error',
        '-32000': 'Server error'
    },

    request: function(method, id, params, encoded) {
        var req = util.format('{"jsonrpc":"2.0","method":"%s"', method);
        // the if/else pattern is ugly but fast
        if (!id && !params)
            return req + '}';
        else if (!params)
            return util.format('%s,"id":%s', req, id);
        else if (!id)
            return util.format('%s,"params":%s}', req, encoded ? params : JSON.stringify(params));
        else
            return util.format('%s,"params":%s,"id":%s}', req, encoded ? params : JSON.stringify(params), id);
    },

    response: function(id, result, encoded) {
        if (result === undefined)
            result = null;
        return util.format('{"jsonrpc":"2.0","id":%s,"result":%s}', id, encoded ? result : JSON.stringify(result));
    },

    error: function(id, code, message, data, encoded) {
        var err = util.format('{"jsonrpc":"2.0","id":%s,"error":{"code":%s,"message":"%s"', id, code, message);
        // the if/else pattern is ugly but fast
        if (data == null)
            return err + '}}';
        else
            return util.format('%s,"data":%s}}', err, encoded ? data : JSON.stringify(data));
    },

    parse: function(data) {
        return JSON.parse(String(data));
    }
};

var rpc = function(target, signatures) {
    if (signatures === undefined) {
        signatures = true;
        if (target instanceof Boolean) {
            signatures = target;
            target = null;
        }
    }

    var stream, callbacks = {}, counter = 0;

    var handle = function(data) {
        data = jsonrpc.parse(data);
        // request? => check 'method'
        if ('method' in data)
            handleRequest(data);
        // response? => check 'result' or 'error'
        else if ('result' in data)
            handleResponse(data);
        else if ('error' in data)
            handleError(data);
    };

    var handleRequest = function(req) {
        if (!target)
            return;
        // again, the code is ugly but fast
        try {
            var callback = function(err, res) {
                if (err)
                    throw '';
                if (req.id)
                    stream.emit('data', jsonrpc.response(req.id, res) + '\n');
            };
            route(req.method, req.params, callback);
        } catch (err) {
            if (req.id)
                stream.emit('data', jsonrpc.error(req.id, err.code, err.message, err.data) + '\n');
        }
    };

    var handleResponse = function(res) {
        if (res.id && callbacks[res.id]) {
            callbacks[res.id](null, res.result);
            delete callbacks[res.id];
        }
    };

    var handleError = function(res) {
        if (res.id && callbacks[res.id]) {
            var err = new Error(util.format('%s (%s)', res.error.message, res.error.code));
            err.code = res.error.code;
            err.data = res.error.data;
            callbacks[res.id](err);
            delete callbacks[res.id];
        }
    };

    var route = function(route, params, callback) {
        try {
            // resolve the route for function mapping
            // sub-calls may be separated by period chars;
            var _target = target;
            var parts = route.split('.');
            while (parts.length > 1) {
                var part = parts.shift();
                if (_target[part])
                    _target = _target[part];
                else
                    break;
            }
            var fn = _target[parts[0]];
            if (fn instanceof Function) {
                if (signatures && params instanceof Array) {
                    params.push(callback);
                    fn.apply(null, params);
                    return;
                }
                fn(params, callback);
                return;
            } else {
                throw {
                    code: -32601,
                    message: util.format('Method \'%s\' not found', route),
                    data: null
                }
            }
            throw '';
        } catch (err) {
            var msg = jsonrpc.errors['-32603'];
            throw {
                code: -32603,
                message: err ? util.format("%s (%s)", msg, err.toString()) : msg,
                data: null
            }
        }
    };

    // define the stream
    stream = through(handle);

    var invoke = function(route, params, callback, encoded) {
        if (callback)
            callbacks[++counter] = callback;
        var req = jsonrpc.request(route, callback ? counter : null, params, encoded);
        stream.emit('data', req + '\n');
        // unlikely but consistent
        if (callback && counter == Number.MAX_VALUE)
            counter = 0;
        return stream;
    };

    var wrap = function(route, keys) {
        // handle arguments
        if (keys === undefined) {
            keys = route;
            route = null;
        }
        // create a wrapper
        wrapper = {};
        // add functions to the wrapper based on invoke
        keys.forEach(function(key) {
            wrapper[key] = function() {
                var args = Array.prototype.slice.call(arguments);
                // the last arguments might be a callback
                var cb = null;
                if (args[args.length-1] instanceof Function)
                    cb = args.pop();
                if (route)
                    key = route + "." + key;
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

module.exports = rpc;
