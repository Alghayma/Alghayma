var path = require('path')
var config = require(path.join(process.cwd(), 'config'));
var https = require('https')

exports.refreshToken = function refreshToken(graph, mongoose,callback){
	var FBUser = mongoose.model('FBUser');
	FBUser.find(function(err, users){
		if (err){
			console.log('Error while changing access token:\n' + err);
			return;
		}
		function pickUser (){
			var numUsers = users.length;
			if (users.length == 0) {console.log("We ran out of tokens"); process.exit(0)};
			var chosenUserIndex = Math.round(Math.random()) * (numUsers - 1);
			var selectedUser = users[chosenUserIndex];

			var options = {
			  hostname: 'graph.facebook.com',
			  port: 443,
			  path: '/debug_token'+"?input_token="+selectedUser.accessToken+"&access_token="+config.fbGraphAccessToken,
			  method: 'GET'
			};

			var req = https.request(options, function(res) {
			  if(res.statusCode != 200){pickUser(); return}
			  res.setEncoding('utf8');
			  res.on('data', function (string) {
			  	var chunk = JSON.parse(string)
			    if (chunk) {
			    	if (chunk.data) {
			    		if (chunk.data.is_valid) {
			    			graph.setAccessToken(selectedUser.accessToken);
			    			if (callback && typeof callback == 'function') callback();
			    			return;
			    		}
			    		else{
			    			console.log("The token we tried to use has been revoked. Deleting from database")
			    			selectedUser.remove(function(err){});
			    			users = users.splice(chosenUserIndex, 1);
			    			pickUser();
			    			return;
			    		}
			    	} else{
			    		pickUser();
			    		return;
			    	}
			    } else{
			    	pickUser();
			    	return;
			    }
			  });
			});

			req.on('error', function(e) {
			  console.log('problem with request: ' + e.message);
			});

			req.end();
		}
		pickUser();
	});
}