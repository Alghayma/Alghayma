var cluster = require('cluster');
var kue = require('kue');
var jobs = kue.createQueue();
var express = require('express');
var numCPUs = require('os').cpus().length;
var path = require('path');
var config = require(path.join(__dirname, "config"));
var fbBgWorker = require(path.join(process.cwd(), 'extensions', 'Facebook', 'backgroundJob'));
var net = require('net');
var remakeJobQueue = false;

if (cluster.isMaster) {
  
  var clearJobs = function(err, ids){
    ids.forEach(function(id){
      kue.Job.get(id, function(err, aJob){
        if (err) {console.log("Couldn't get completed job because : " + err)}
        aJob.remove(function(err){if (err) {"Failed to delete completed job"}});
      })
    });
  }

  if (remakeJobQueue) {
    jobs.active(clearJobs);
    jobs.failed(clearJobs);
    jobs.inactive(clearJobs);

    // Now let's get all the feeds of the DB and launch jobs for them

    fbBgWorker.scheduleAllFeeds(jobs);

  } else {
    var reschedule = function( err, ids ){
      ids.forEach( function( id ){
        kue.Job.get( id, function(err, failedJob){
          if (err) {
            console.log("An error occured while retreiving a failed job : "+ err);
          } else{
            failedJob.remove(function(err){
              if (err) {
                console.log("An error occured while removing a failed job : "+ err);
              } else{
                jobs.create('facebookJob', {title: "Backup of " + failedJob.data.feedname, feed: failedJob.data.feedID}).priority('high').save();
              }
            });
          }
        });
      });
    };

    jobs.active(reschedule);
    jobs.failed(reschedule);
  }

  // Clean completed job queue 

  jobs.complete(clearJobs);

  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  var app = express();
  app.use(express.basicAuth(config.kueBasicAuthLogin, config.kueBasicAuthPass));
  app.use(kue.app);
  app.listen(3001);

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');

    function isEmpty(obj) {
      for(var prop in obj) {
        if(obj.hasOwnProperty(prop)) return false;
      }
      return true;
    }

    if (isEmpty(cluster.workers)){
      console.log("All workers exited - Shutting down")
      process.exit(0)
    }
  });


  process.once( 'SIGINT', function ( sig ) {
    console.log("SIGINT Received");
    jobs.shutdown(function(err) {
      console.log( 'Kue is shut down.', err||'' );
    } , 600000);
  });

  jobs.promote();

} else {
    
    fbBgWorker.setToken(function(){
      console.log("Worker is spawned, token set and ready to process your requests sir");
      jobs.process('facebookJob', function(job, done){
        process.once( 'SIGINT', function ( sig ) {
          fbBgWorker.setKiller();
          jobs.shutdown();
          domain.dispose();
        });
        console.log("New Job starting : Backupping " + job.data.feedname);

        var domain = require('domain').create();

        domain.on('error', function(er) {
        // If the backup crashes, log the error and return failed.
          console.log("The Facebook page " + job.data.feedname + " couldn't be backed up. Because " + er);
          done(er);
        });

        domain.run(function() {
          fbBgWorker.launchFeedBackup(job, jobs, done);
        });
      });
    });
}
