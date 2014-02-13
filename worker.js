var cluster = require('cluster');
var kue = require('kue');
var jobs = kue.createQueue();
var numCPUs = require('os').cpus().length;
var path = require('path');
var fbBgWorker = require(path.join(process.cwd(), 'extensions', 'Facebook', 'backgroundJob'));

if (cluster.isMaster) {
  
  kue.app.listen(3001);

  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });

} else {
	jobs.process('facebookJob', function(job, done){
		fbBgWorker.launchFeedBackup(job, undefined, jobs);
    });
}


