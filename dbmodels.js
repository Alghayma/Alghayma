var config = require('./config');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Feed = new Schema({
	id: String,
	name: String,
	type: String,
	url: String,
	lastUpdated: Date
});

var Post = new Schema({
	postId: String, //Random post id?
	feed: String, //Name attribute of one of the Feeds (as defined above)
	postDate: Date,
	postText: String,
	story: String,
	tags: Array,
	media: Array,
	picture: String,
	likes: Number,
	replies: Number
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