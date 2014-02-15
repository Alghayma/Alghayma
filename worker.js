var cluster = require('cluster');
var kue = require('kue');
var jobs = kue.createQueue();
var express = require('express');
var numCPUs = require('os').cpus().length;
var path = require('path');
var config = require(path.join(process.cwd(), "config"))
var fbBgWorker = require(path.join(process.cwd(), 'extensions', 'Facebook', 'backgroundJob'));

if (cluster.isMaster) {
  var app = express();
  app.use(express.basicAuth(config.kueBasicAuthLogin, config.kueBasicAuthPass));
  app.use(kue.app);
  app.listen(3001);

  // Leaving a max of 10 minutes to complete action. Long backups are longer but doesn't matter since we can resume them.
  process.once( 'SIGTERM', function ( sig ) {
    queue.shutdown(function(err) {
      console.log( 'Kue is shut down.', err||'' );
      process.exit( 0 );
    } , 600000);
  });

  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });

} else {
	jobs.process('facebookJob', function(job, done){
		fbBgWorker.launchFeedBackup(job, jobs, done);
  });
}


