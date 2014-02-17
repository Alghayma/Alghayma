var cluster = require('cluster');
var kue = require('kue');
var jobs = kue.createQueue();
var express = require('express');
var numCPUs = require('os').cpus().length;
var path = require('path');
var config = require(path.join(process.cwd(), "config"));
var fbBgWorker = require(path.join(process.cwd(), 'extensions', 'Facebook', 'backgroundJob'));

if (cluster.isMaster) {

  jobs.promote();

  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  var app = express();
  app.use(express.basicAuth(config.kueBasicAuthLogin, config.kueBasicAuthPass));
  app.use(kue.app);
  app.listen(3001);

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });

  process.once( 'SIGINT', function ( sig ) {
    jobs.shutdown(function(err) {
      // TODO: Backup jobs in MongoDB
      console.log( 'Kue is shut down.', err||'' );
      process.exit( 0 );
    } , 600000);
  });

} else {

  jobs.process('facebookJob', function(job, done){

    console.log("New Job starting");
    process.once( 'SIGINT', function (sig){
      // It is okay to do this because all writes in Mongo are atomic: http://docs.mongodb.org/manual/core/write-operations/
      job.log("Shutting down but rescheduling backup of " + job.data.feed.name);
      jobs.create('facebookJob', {title: "Backup of " + job.data.feed.name, feed: job.data.feed}).priority('high').delay(10).save(done("Failed to complete task because process shut down"));
    });

    fbBgWorker.launchFeedBackup(job, jobs, done);

  });
}