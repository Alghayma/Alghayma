
/**
 * Module dependencies.
 */

var express = require('express');
var dbmodels = require('./dbmodels');
var routes = require('./routes');
var http = require('http');
var path = require('path');
var backupJob = require('./backup-job');

//Referencing the backupJob instance to the routes object
routes.setBackupJobInstance(backupJob);

var app = express();

// all environments
app.set('port', config.httpport);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(express.bodyParser());
app.use(app.router);
app.use(require('stylus').middleware(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// development only
app.configure('development', function(){
	app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
	app.use(express.errorHandler());
});

app.get('/', routes.index);
app.get('/p', routes.viewpage);
app.get('/chunk', routes.chunk);
app.get('/media/:postid/:mediaid', routes.media);
app.post('/backup', routes.backup);
app.get('/auth', routes.fbauth);

http.createServer(app).listen(app.get('port'), function(){
	console.log('Express server listening on port ' + app.get('port'));
	backupJob.start();
	console.log('Backup system started');
});