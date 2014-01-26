var mongoose = require('mongoose');
var Feed = mongoose.model('Feed');
var Post = mongoose.model('Post');
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: 'Alghayma' });
};

exports.viewpage = function(req, res){
	var sourceUrl = req.body.sourceUrl;
	//Checking that the user-provided URL is from facebook. Beware this is very dirty.
	if (!(sourceUrl.indexOf('http://facebook.com') == 0 || sourceUrl.indexOf('https://facebook.com') == 0 || sourceUrl.indexOf('http://www.facebook.com') == 0 || sourceUrl.indexOf('https://facebook.com'))){

	}
	Feed.findOne(sourceUrl, function(err, feed){
		if (err){
			throw err;
			res.send(500, 'Internal error');
			return;
		}
		if (feed){
			Post.find({name: feed.name}, function(err, posts){
				if (err){
					throw err;
					res.send(500, 'Internal error');
					return;
				}
				if (posts && posts.length > 0){
					res.render('feed', {title: feed.name + ' - Alghayma', posts: posts})
				} else {
					res.render('message', {title: 'Error', message: 'Sorry. This feed is registered on Alghayma, but it hasn\'t been backed up yet. Please come back later.'});
				}
			});
		} else {
			res.render('message', {title: 'Back it up!'});
		}
	})
};

exports.backup = function(req, res){

};

exports.fbcallback = function(req, res){
	//FB Graph API authentication model is confusing me...
};