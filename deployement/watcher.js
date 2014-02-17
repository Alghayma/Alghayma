var express = require('express');
var app = express();
var forever = require('forever-monitor');
var shell = require('shelljs');
var githubSourceSubnet = "192.30.252.0/22";
var execPath = __dirname;
var path = require('path')
var fs = require('fs');

var repoRootPath = path.join(execPath, "..");
var pathToLogs = path.join(repoRootPath, "logs")

var mainInstance = undefined;
var queue = undefined;

// Initialization - Make dir for logging

if (!fs.existsSync(pathToLogs)) {
	fs.mkdirSync(pathToLogs);
}

app.use(express.bodyParser());
app.listen(3002);

app.post('/deploy/instance', function(req, res){
	if (inSubNet(req.header("X-Real-IP"), githubSourceSubnet)){
		if(req.body.ref === "refs/heads/production"){
			console.log("Time to deploy a new instance")
            console.log(req.body.pusher.name + " is so awesome for pushing code!")
            res.send(); // Be polite with GitHub and acknowledge their post!
            deploy();
		}
	}
	else{
		console.log("We got a deploy request from someone who wasn't GitHub");
	}
});

// Methods to deal with subnet verification

var ip2long = function(ip){
    var components;

    if(components = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/))
    {
        var iplong = 0;
        var power  = 1;
        for(var i=4; i>=1; i-=1)
        {
            iplong += power * parseInt(components[i]);
            power  *= 256;
        }
        return iplong;
    }
    else return -1;
};

var inSubNet = function(ip, subnet)
{   
    var mask, base_ip, long_ip = ip2long(ip);
    if( (mask = subnet.match(/^(.*?)\/(\d{1,2})$/)) && ((base_ip=ip2long(mask[1])) >= 0) )
    {
        var freedom = Math.pow(2, 32 - parseInt(mask[2]));
        return (long_ip > base_ip) && (long_ip < base_ip + freedom - 1);
    }
    else return false;
};

function gitPull(root, options)
{
    var cmd = 'git pull --rebase';
	shell.cd(root);
    shell.exec(cmd, function(code, output) {
    	console.log(cmd + ' exited with code ' + code);

        shell.exec("npm install", function(code, output) {

            // Awesome, we checked out the new changes. Let's now restart the instances!

            mainInstance = new (forever.Monitor)("app.js", {
            	'silent': true,
            	'killTree': true,
            	'sourceDir': repoRootPath,
            	'watch': false,
            	'logFile': path.join(pathToLogs, "mainDeamon.log"),
            	'outFile': path.join(pathToLogs, "mainOut.log"),
            	'errFile': path.join(pathToLogs, "mainError.log")
            });
            queue = new (forever.Monitor)("worker.js", {
            	'silent': true,
            	'killTree': true,
            	'sourceDir': repoRootPath,
            	'watch': false,
            	'logFile': path.join(pathToLogs, "queueDeamon.log"),
            	'outFile': path.join(pathToLogs, "queueOut.log"),
            	'errFile': path.join(pathToLogs, "queueError.log")
            });

            mainInstance.start();
            queue.start();

            console.log("Instances (re)started");

            });
    });
   
}

function deploy (){
	if (mainInstance) {
		mainInstance.stop();
	}
	if (queue) {
		queue.stop();
	}

	// Both instances are stopped. Let's now proceed to the git pull 

	gitPull(repoRootPath)

}

deploy()
