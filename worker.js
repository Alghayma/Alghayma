var cluster = require('cluster');
var kue = require('kue');
var jobs = kue.createQueue();
var express = require('express');
var numCPUs = require('os').cpus().length;
var path = require('path');
var config = require(path.join(process.cwd(), "config"));
var fbBgWorker = require(path.join(process.cwd(), 'extensions', 'Facebook', 'backgroundJob'));
var net = require('net');
var noop = function() {};

if (cluster.isMaster) {
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
              jobs.create('facebookJob', {title: "Backup of " + failedJob.data.feed.name, feed: failedJob.data.feed}).priority('high').save();
            }
          });
        }
      });
    });
  };

  jobs.active(reschedule);
  jobs.failed(reschedule);

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
  //    process.exit( 0 );
    } , 600000);
  });

  // Queue cleanup

  jobs.CLEANUP_MAX_FAILED_TIME = 30 * 24 * 60 * 60 * 1000;  // 30 days
  jobs.CLEANUP_MAX_ACTIVE_TIME = 1 * 24 * 60 * 60 * 1000;  // 1 day
  jobs.CLEANUP_MAX_COMPLETE_TIME = 5 * 24 * 60 * 60 * 1000; // 5 days

  // this is a simple log action
  function QueueActionLog(message) {
    this.message = message || 'QueueActionLog :: got an action for job id(%s)';

    this.apply = function(job) {
      console.log(util.format(this.message, job.id));
      return true;
    };
  }

  // remove item action
  function QueueActionRemove(age) {
    this.age = age;

    this.apply = function(job) {
      job.remove(noop);
      return true;
    };
  }

  function QueueFilterAge(age) {
      this.now = new Date().getTime();
      this.age = age;

      this.test = function(job) {
          var created = parseInt(job.created_at);
          var age = this.now - created;
          return age > this.age;
      };
   }

  // the queue iterator
  var queueIterator = function(ids, queueFilterChain, queueActionChain) {
    ids.forEach(function(id, index) {
      // get the kue job
      kue.Job.get(id, function(err, job) {
        if (err || !job) return;
        var filterIterator = function(filter) { return filter.test(job) };
        var actionIterator = function(filter) { return filter.apply(job) };

        // apply filter chain
        if(queueFilterChain.every(filterIterator)) {

          // apply action chain
          queueActionChain.every(actionIterator);
        }
      });
    });
  };

  function performCleanup() {
    var ki = new kue;

    // ki.failed(function(err, ids) {
    //   if (!ids) return;
    //   queueIterator(
    //     ids,
    //     [new QueueFilterAge(jobs.CLEANUP_MAX_FAILED_TIME)],
    //     [new QueueActionLog('Going to remove job id(%s) for being failed too long'),
    //       new QueueActionRemove()]
    //   );
    // });

    // ki.active(function(err, ids) {
    //   if (!ids) return;
    //   queueIterator(
    //     ids,
    //     [new QueueFilterAge(jobs.CLEANUP_MAX_ACTIVE_TIME)],
    //     [new QueueActionLog('Going to remove job id(%s) for being active too long'),
    //       new QueueActionRemove()]
    //   );
    // });

    ki.complete(function(err, ids) {
      if (!ids) return;
      queueIterator(
        ids,
        [new QueueFilterAge(jobs.CLEANUP_MAX_COMPLETE_TIME)],
        [new QueueActionLog('Going to remove job id(%s) for being complete too long'),
          new QueueActionRemove()]
      );
    });
  }

  function rebuildAllQueue(){

  }

  function clearJobs(){
    // Cleanup removes old completed jobs
    performCleanup();
  }

  function promoteDelayed(){
    jobs.promote();
  }

  clearJobs();
  promoteDelayed();

} else {
  
    jobs.process('facebookJob', function(job, done){
      process.once( 'SIGINT', function ( sig ) {
        fbBgWorker.setKiller();
        jobs.shutdown()
      });
      console.log("New Job starting : Backupping " + job.data.feed.name);

      var domain = require('domain').create();

      domain.on('error', function(er) {
      // If the backup crashes, log the error and return failed.
        console.log("The Facebook page " + job.data.feed.name + " couldn't be backed up. Because " + er)
        done(er);
      });

      domain.run(function() {
        fbBgWorker.launchFeedBackup(job, jobs, done);
      });

  });
}
