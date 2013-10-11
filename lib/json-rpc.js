var through = require('through');

var format = function (s) {
    var args = [].slice.call(arguments, 1);
    return s.replace(/\{(\d+)\}/g, function (_, arg) {
        return arg in args ? args[arg] : _;
    });
};

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
        var req = format('{"jsonrpc":"2.0","method":"{0}"', method);
        // the if/else pattern is ugly but fast
        if (!id && !params)
            return req + '}';
        else if (!params)
            return format('{0},"id":{1}}', req, id);
        else if (!id)
            return format('{0},"params":{1}}', req, encoded ? params : JSON.stringify(params));
        else
            return format('{0},"params":{1},"id":{2}}', req, encoded ? params : JSON.stringify(params), id);
    },

    response: function(id, result, encoded) {
        if (result === undefined)
            result = null;
        return format('{"jsonrpc":"2.0","id":{0},"result":{1}}', id, encoded ? result : JSON.stringify(result));
    },

    error: function(id, code, message, data, encoded) {
        var err = format('{"jsonrpc":"2.0","id":{0},"error":{"code":{1},"message":"{2}"', id, code, message);
        // the if/else pattern is ugly but fast
        if (data == null)
            return err + '}}';
        else
            return format('{0},"data":{1}}}', err, encoded ? data : JSON.stringify(data));
    },

    parse: function(data) {
        return JSON.parse(String(data));
    }
};

var rpc = function(target, signatures) {
    if (signatures === undefined && target instanceof Boolean) {
        signatures = target;
        target = null;
    }
    signatures = signatures == null ? true : signatures;
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
        } catch (e) {
            if (req.id)
                stream.emit('data', jsonrpc.error(req.id, e.code, e.message, e.data) + '\n');
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
            var err = new Error(format('{0} ({1})', res.error.message, res.error.code));
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
            var _target = target, parts = route.split('.');
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
                    message: format('Method \'{0}\' not found', route),
                    data: null
                }
            }
            throw '';
        } catch (e) {
            throw e || {
                code: -32603,
                message: jsonrpc.errors['-32603'],
                data: null
            }
        }
    };

    var invoke = function(route, params, callback, encoded) {
        if (callback)
            callbacks[++counter] = callback;
        var req = jsonrpc.request(route, callback ? counter : null, params, encoded);
        stream.emit('data', req + '\n');
        // unlikely but consistent
        if (callback && counter == Number.MAX_VALUE)
            counter = 0;
    };

    var wrap = function(route, keys) {
        if (!(keys instanceof Array))
            keys = [keys];
        wrapper = {};
        for (var i in keys) {
            wrapper[keys[i]] = function() {
                var args = [].slice.call(arguments), callback;
                if (args[args.length-1] instanceof Function)
                    callback = args.pop();
                invoke(route + '.' + keys[i], args, callback);
            };
        }
        return wrapper;
    };

    stream = through(handle);
    stream.invoke = invoke;
    stream.wrap = wrap;

    return stream;
};

module.exports = rpc;
