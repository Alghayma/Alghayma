var mongoosee = require('mongoose')

exports.initializeDBModels = function(mongoose){
	var FBFeed = exports.FBFeed

	var FBPost = exports.FBPost

	var FBUser = exports.FBUser

	mongoose.model('FBFeed', FBFeed);
	mongoose.model('FBPost', FBPost);
	mongoose.model('FBUser', FBUser);

	console.log("Mongoose models for Facebook initialized")

	mongoose = mongoose
}

exports.FBUser = new mongoosee.Schema({
		id: String,
		accessToken: String
	});

exports.FBPost = new mongoosee.Schema({
		postId: String, //Fb post id, or random alphanumerical string for other post types
		feedId: String, //From Feed collection, or random alphanumerical
		postDate: Date,
		postText: String,
		story: String,
		storyLink: String, //Link preview text
		picture: String //if a unique picture exists
	});

exports.FBFeed = new mongoosee.Schema({
		id: String, //Fb ID (which are digits only) or random alphanumerical string for other feed types
		name: String,
		type: String,
		url: String, //Vanity name
		profileImage: String,
		didBackupHead: {type: Boolean, default:0}, // The head is the oldest post of the feed. Because pages are navigated from newest to oldest post, this flag allows us to know if the oldest post was backed up.
		lastBackup: Date
	});