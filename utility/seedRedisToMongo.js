var kue = require('kue');
var jobs = kue.createQueue();
var path = require('path');
var config = require(path.join(__dirname, "..", 'config'));
var mongoose = require('mongoose');
var fbgraph = require('fbgraph');
var FBFeed;
var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';
connectionString += config.dbhost + ':' + config.dbport + '/';
connectionString += config.dbname;
mongoose.connect(connectionString, function(err){ if (err) throw err; });
require(path.join(__dirname, "..", "extensions", "Facebook", "models.js")).initializeDBModels(mongoose);

FBFeed = mongoose.model('FBFeed');
var fbUtil = require(path.join(__dirname, "..", "extensions", "Facebook", 'fbUtils'));
var fb = require(path.join(__dirname, "..", "extensions", "Facebook", 'Facebook'));
fbUtil.refreshToken(fbgraph, mongoose, function(){
	console.log("Running");
	jobs.active(seedJob);
	jobs.failed(seedJob);
	jobs.inactive(seedJob);
});

var seedJob = function(err, ids){
    console.log(ids)
    ids.forEach(function(id){
      kue.Job.get(id, function(err, aJob){
        if (err) {console.log("Couldn't get completed job because : " + err)}
       	console.log(aJob)
        fbgraph.get(aJob.data.feedID + '?fields=id,name,link,picture', function(err, res){
        	if (err) { 
        		throw err;
        	}else {
       			var newFeed = new FBFeed({
					id: res.id,
					name: res.name,
					type: 'fbpage',
					url: fb.getFBPath(res.link),
					profileImage: res.picture.data.url,
					didBackupHead: false
				});
				newFeed.save();
        });
      });
   });
 }