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


// create a wrapper object around fs
var wrappedFs = local.wrap("fs", ["readdir", "rename", "fstat"]);

// call readdir on the remote object in a local manner
wrappedFs.readdir("/", function(err, list) {
  console.log(list);
});
