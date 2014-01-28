var mongooose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require('./config');

var

//Extend
var FbUser = mongoose.model('FbUser');
FbUser.find(function(err, users){
	if (err){
		throw err;
		process.exit();
	}
	if (users && users.length > 0){

	}
});

module.exports = {};

exports.launchFeedBackup = function(feedUrl){

};

exports.addFeed = function(feedUrl){

};