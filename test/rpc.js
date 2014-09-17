var rpc = require(__dirname + "/../lib/json-rpc.js").rpc;


// define a remote rpc object that may live on a remote worker (e.g. via exec)
var remote = rpc({
  foo: function(callback) {
    callback(null, "bar", 123);
  },
  fs: require("fs")
});

// define a local rpc object
var local  = rpc();


// connect both rpc objects
local.pipe(remote).pipe(local);


// perform a test request
local.invoke("foo", function(err, data) {
  console.log(data);
});

// perform a remote fs.readdir
local.invoke("fs.readdir", ["/"], function(err, list) {
  console.log(list);
});
