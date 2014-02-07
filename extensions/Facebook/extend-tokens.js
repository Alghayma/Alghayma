var dbmodels = require('./dbmodels');
var mongoose = require('mongoose');
var path = require('path');
var config = require(path.join(process.cwd(), 'config'));
var fbgraph = require('fbgraph');

var FbUser = mongoose.model('FBUser');

var usersUpdated = 0;
var waitEndInterval;

FbUser.find(function(err, users){
	if (err) throw err;
	for (var i = 0; i < users.length; i++){
		extendAccessToken(users[i].accessToken, users[i].id);
	}
	waitEndInterval = setInterval(function(){
		if (usersUpdated == users.length){
			console.log('All users have their tokens updated');
			clearInterval(waitEndInterval);
			process.exit();
		}
	}, 50);
});

function extendAccessToken(accessToken, id){
	fbgraph.extendAccessToken({
		"access_token": accessToken,
		"client_id": config.fbappid,
		"client_secret": config.fbapptoken
	}, function(err, fbRes){
		if (err) throw err;
		console.log(JSON.stringify(fbRes));
		FbUser.update({id: id}, {accessToken: fbRes.access_token}).exec(function(err){
			if (err) console.log('Error when updating DB:\n' + err);
			usersUpdated++;
		});
	})
}
