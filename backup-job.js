var mongooose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require('./config');

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