var config = require('./config');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Feed = new Schema({
	id: String, //Fb ID (which are digits only) or random alphanumerical string for other feed types
	name: String,
	type: String,
	url: String,
	profileImage: String,
	lastBackup: Date
});

var Post = new Schema({
	postId: String, //Fb post id, or random alphanumerical string for other post types
	feedId: String, //From Feed collection, or random alphanumerical
	postDate: Date,
	postText: String,
	storyLink: String, //Link preview text
	media: Array, //path on server to linked media assets
	picture: String //if a unique picture exists
});

var FbUser = new Schema({
	id: String,
	accessToken: String
});

var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';
connectionString += config.dbhost + ':' + config.dbport + '/' + config.dbname;

mongoose.connect(connectionString, function(err){ if (err) throw err; });

mongoose.model('Feed', Feed);
mongoose.model('Post', Post);
mongoose.model('FbUser', FbUser);

mongoose.connection.on('error', console.error.bind(console, 'DB connection error : '));
mongoose.connection.once('open', function(){
	console.log('Connection to DB established, ya zalameh');
});