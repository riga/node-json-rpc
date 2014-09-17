var specs = require(__dirname + "/../lib/json-rpc.js").specs;

var log = function() {
  console.log.apply(console, arguments);
};

// request
log("requests:");
log(specs.request("foo"));
log(specs.request("foo", 123));
log(specs.request("foo", 123, {bar: 456, test: null}));
log(specs.request("foo", 123, '{"bar":456,"test":null}', true));
log(specs.request("foo", 123, [1, 2, 3, "test", true]));
log(specs.request("foo", 123, '[1,2,3,"test",true]', true));

// response
log("\nresponses:");
log(specs.response(123, {bar: 456, test: null}));
log(specs.response(123, '{"bar":456,"test":null}', true));
log(specs.response(123, [1, 2, 3, "test", true]));
log(specs.response(123, '[1,2,3,"test",true]', true));

// errors
log("\nerrors:");
log(specs.error(123, 1, "nope"));
log(specs.error(123, 1, "nope", [1, 2, 3, "test", true]));
log(specs.error(123, 1, "nope", '[1,2,3,"test",true]', true));

log("\ndone");
