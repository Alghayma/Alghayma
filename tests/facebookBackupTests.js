

// IMPORTANT - FOR TESTS TO BE ABLE TO RUN MAKE SURE YOU HAVE A VALID fbuser with a token in your test database.

var path = require('path');
var fbBgWorker = require(path.join(__dirname, ".." , 'extensions', 'Facebook', 'backgroundJob'));

// For the test page we use a small page because it's more convenient.

// Testpage : https://www.facebook.com/kafrev

var mongoose = require('mongoose');
var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';

connectionString += config.dbhost + ':' + config.dbport + '/' + "tests";

mongoose.connect(connectionString, function(err){ 
	if (err){
		throw err; 
	}
	else{
		initializations();
		startTests();
		feed = {}
	}
});

var feed;
var job = {};
job.log = console.log;  // We want to log the queuing functions as well
var done = function (err){
	console.log("Done: " + err);
}

function initializations(){
	feed = {                                                                                                                                                                                                           │···
        "__v" : 0,                                                                                                                                                                                          │···
        "_id" : ObjectId("5305d6308431a2347b68e562"),                                                                                                                                                       │···
        "didBackupHead" : false,                                                                                                                                                                             │···
        "id" : "537011102992127",                                                                                                                                                                           │···
        "lastBackup" : false,                                                                                                                                                 │···
        "name" : "Kafranbel Syrian Revolution",                                                                                                                                                             │···
        "profileImage" : "https://fbcdn-profile-a.akamaihd.net/hprofile-ak-prn2/t5/203542_537011102992127_1421717180_q.jpg",                                                                                │···
        "type" : "fbpage",                                                                                                                                                                                  │···
        "url" : "kafrev"                                                                                                                                                                                    │···
	}

	fbBgWorker.setToken(function(){
		startTests();
	};

}

function fetchAll (){
	fbBgWorker.
}

function fetchTail (){

}

function fetchUpdate (){

}

function startTests(){

	console.log("Testing initial Facebook backup");
	

	fetchAll()
}