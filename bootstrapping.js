/**
 * The bootstrapping script does initialize the different extensions (initializing DB schemes, compiling paths patterns ...)
 */

module.exports = function (express, routes){

	var fs = require('fs');
	var path = require('path');
	var config = require('./config');
	var mongoose = require('mongoose');

	var connectionString = 'mongodb://';
	if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';
	connectionString += config.dbhost + ':' + config.dbport + '/' + config.dbname;

	mongoose.connect(connectionString, function(err){ if (err) throw err; });

	// We initialize all of the extensions modules
	var exts = fs.readdirSync(path.join(__dirname, "extensions"))

	console.log("Loading extensions ...")
	var extensions = [];
	for (var i = exts.length - 1; i >= 0; i--){
		if (fs.statSync(path.join(__dirname, "extensions", exts[i])).isDirectory()){
			var currentExt = require(path.join(__dirname, "extensions", exts[i], exts[i]));
			// Initialize database models
			currentExt.initializeDBModels(mongoose);
			// Initialize backup job
			currentExt.setBackupJobInstance(require(path.join(__dirname, "extensions", exts[i], "backup-job")));
			// Setup ExpressJS routes
			currentExt.setupRoutes(express, exts[i]);
			extensions.push(currentExt);
		}
	}

	mongoose.connection.on('error', console.error.bind(console, 'DB connection error : '));
	mongoose.connection.once('open', function(){
	console.log('Connection to DB established, ya zalameh.');
	});
}