

// IMPORTANT - FOR TESTS TO BE ABLE TO RUN MAKE SURE YOU HAVE A VALID fbuser with a token in your test database.
var path = require('path');
var fbBgWorker = require(path.join(__dirname, ".." , 'extensions', 'Facebook', 'backgroundJob'));
fbBgWorker.setTesting();
var config = require(path.join(__dirname, "..", 'config'));
// For the test page we use a small page because it's more convenient.

// Testpage : https://www.facebook.com/kafrev

var mongoose = require('mongoose');
var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';

connectionString += config.dbhost + ':' + config.dbport + '/' + "alghaymaTests";

mongoose.createConnection(connectionString, function(err){ 
	if (err){
		throw err; 
	}
	else{

		mongoose.connection.collections['fbposts'].drop( function(err) {
    		initializeFetchAll();
			feed = {};
		});
	}
});

require(path.join(__dirname, "..", "extensions", "Facebook", "models.js")).initializeDBModels(mongoose);

var FBUser = mongoose.model('FBUser');
var FBFeed = mongoose.model('FBFeed');
var FBPost = mongoose.model('FBPost');

var feed;
var job = {};
job.log = console.log;  // We want to log the queuing functions as well

var queue = {};


function initializeFetchAll(){
	
	feed = {                                                                                                                                                                                                        
        "__v" : 0,
        "didBackupHead" : false,
        "id" : "537011102992127",
        "lastBackup" : false,
        "name" : "Kafranbel Syrian Revolution",
        "profileImage" : "https://fbcdn-profile-a.akamaihd.net/hprofile-ak-prn2/t5/203542_537011102992127_1421717180_q.jpg",
        "type" : "fbpage",
        "url" : "kafrev"
    };
	job.data = {};
	job.data.feed = feed;

	fbBgWorker.setToken(function(){
		startTests();
	});

}

function fetchAll (){
	fbBgWorker.launchFeedBackup(job, queue, assertAll);
}

function assertAll (err){
	if (err) {
		console.log("We failed to backup all posts. Failed with error: " +  err);
	} else {
		console.log("Task completed without error messages");
		FBPost.count({feedId:feed.id}).exec(function (err, count){
			console.log("We backed up a total of " + count + " posts.");
		});
	}
}

function fetchTail (){

}

function verifyHeadFlagSet(){

}

function fetchUpdate (){

}

function startTests(){

	console.log("Testing initial Facebook backup");

	fetchAll();
}