function hello (assert, done) {
	var path = require('path');
	var dropOnLaunch = true;
	var fbBgWorker = require(path.join(__dirname, ".." , 'extensions', 'Facebook', 'backgroundJob'));
	fbBgWorker.setTesting();
	var config = require(path.join(__dirname, "..", 'config'));

	/**

	TEST PARAMETERS

	**/

	var numberOfPostsToDeleteTail = 10;
	var numberOfPostsToDeleteHead = 10;

	// Kafranbel
	//var pageID = "537011102992127";
	//var pageURL = "kafrev";

	// HackEPFL

	var pageURL = "hackepfl";
	var pageID = "295515750564317";

	// For the test page we use a small page because it's more convenient.

	// Testpage : https://www.facebook.com/kafrev

	var mongoose = require('mongoose');
	var connectionString = 'mongodb://';
	if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';

	connectionString += config.dbhost + ':' + config.dbport + '/';
	connectionString += config.dbname;

	var FBUser, FBFeed, FBPost;

	mongoose.createConnection(connectionString, function(err){
		console.log("It's running!")
		if (err){
			throw err; 
		} else{
			require(path.join(__dirname, "..", "extensions", "Facebook", "models.js")).initializeDBModels(mongoose);
			FBUser = mongoose.model('FBUser');
			FBFeed = mongoose.model('FBFeed');
			FBPost = mongoose.model('FBPost');
			dropPostTable(initializeFetchAll);
		}
	});

	function dropPostTable(callback){
		if (dropOnLaunch) {
			mongoose.connection.collections['fbposts'].drop( function(err) {
				mongoose.connection.collections['fbfeeds'].drop( function(err) {
					callback();
				});
			});
		} else {
			callback()
		}
	}

	var job = {};
	job.log = console.log;  // We want to log the queuing functions as well

	var queue = {};
	var feed = {};
	feed.id = pageID;

	function initializeFetchAll(){
		var aFeed = new FBFeed ({                                                                                                                                                                                                        
	        "__v" : 0,
	        "didBackupHead" : false,
	       //"id" : "537011102992127",
	       	"id": pageID,
	        "name" : "Testing page",
	        "profileImage" : "https://fbcdn-profile-a.akamaihd.net/hprofile-ak-prn2/t5/203542_537011102992127_1421717180_q.jpg",
	        "type" : "fbpage",
	        "url" : pageURL
	    });

	    aFeed.save(function(err){
	    	if (err) {console.log("Failed to save feed!");}
	    });

		job.data = {};
		fbBgWorker.setToken(function(){
			fetchAll(feed);
		});
	}

	function fetchAll (feed){
		job.data.feedID = feed.id;
		fbBgWorker.launchFeedBackup(job, queue, assertAll);
	}

	function assertAll (err){
		if (err) {
			console.log("We failed to backup all posts. Failed with error: " +  err);
		} else {
			console.log("Backup task completed without error messages ");

			FBFeed.findOne({id:feed.id}).exec(function(err, theFeed){
				if (err) {throw err}
		  		assert.equal(theFeed.didBackupHead, true, "The backup head flag has NOT been changed");
	  			
	  			theFeed.didBackupHead = false;
	  			theFeed.save(function(err){
	  				if (err) {throw err};
		  			FBPost.count({feedId:feed.id}).exec(function (err, count){
						if (err) {throw err};
						// As right now we know that Kafranbel has more than 
						console.log("We backed up a total of " + count + " posts.");
						if (count < 0){
							console.log("There are obviously posts missing (unless Kafranbel deleted many)");
						} else{
							//Verify that the first post is the one it should be. 
							FBPost.find({feedId:feed.id}).sort({postDate:'asc'}).limit(1).exec(function(err, posts) {
			  					//assert.equal(posts[0].postId, "537011102992127_584219408271296", "Oldest post is not the one we thought it would be. Has https://www.facebook.com/photo.php?fbid=584219394937964&set=a.584219388271298.153069.537011102992127&type=1&relevant_count=1%27 been deleted?");
			  					FBPost.find({feedId:feed.id}).sort({postDate:'desc'}).limit(1).exec(function(err, posts) {
			  						console.log("Was the most recent post posted on the " + posts[0].postDate + " and is containing " + posts[0].postText + " ?");
			  						prepareFetchHead();
			  					});
							});
						}
					});
				});
	  		});
		}
	}

	var postsIDs;
	var postsCount;

	function prepareFetchHead(){
		// Alright. So if previous tests passed, we have now a full backup of the Kafranbel page. Let's screw a few things up and see if it works.

		// In this test we are going to change the flag in the database to "didBackupHead false", delete the 5 oldest posts and run an update to see what happens.

		FBFeed.findOne({id: feed.id}).exec(function(err, theFeed){
			if (err) {throw err};
			FBPost.count({feedId:theFeed.id}, function(err, numberOfPosts){
				if (err) {throw err};
				postsCount = numberOfPosts;

				FBPost.find({feedId:theFeed.id}).sort({postDate:'asc'}).limit(numberOfPostsToDeleteHead).exec(function(err, posts) {
					if (err) {throw err};

					postsIDs = [];

					for (var i = numberOfPostsToDeleteHead - 1; i >= 0; i--) {
						console.log(posts[i]);
						postsIDs.push(posts[i].postId);
						posts[i].remove();
					};

					// Now that posts are deleted let's run the fetch head method
					fetchHead(theFeed);
				});
			});
		});
	}

	function fetchHead(feed){
		job.data.feedID = feed.id;
		fbBgWorker.launchFeedBackup(job, queue, assertHead);
	}

	function assertHead (){
		FBFeed.findOne({id: feed.id}).exec(function(err, theFeed){
			
			assert.equal(theFeed.didBackupHead, true, "Wait, I don't think the fetching from head works!");

			FBPost.find({feedId:theFeed.id}).sort({postDate:'asc'}).limit(numberOfPostsToDeleteHead).exec(function(err, posts) {
				if (err) {throw err};

				for (var i = numberOfPostsToDeleteHead- 1; i >= 0; i--) {
					assert.equal(posts[i].postId, postsIDs[numberOfPostsToDeleteHead-1-i], "Something strange here, the page was not completly restored");
				}

				FBPost.count({feedId:theFeed.id}).exec(function(err, numberOfPosts){
					if (err) {throw err};

					assert.equal(numberOfPosts, postsCount, "Looks like we did take too few/many posts!");

					console.log(">>> Head looks good. let's try to see the tail now");

					prepareFetchTail();

				});
			});
		});	
	}


	function prepareFetchTail(){
		// Alright. So if previous tests passed, we have now a full backup of the Kafranbel page. Let's screw a few things up and see if it works.

		// In this test we are going to delete the x number of most recent posts and resume a backup. Let's see how that plays out.

		FBFeed.findOne({id: feed.id}).exec(function(err, theFeed){
			if (err) {throw err};

			assert.equal(theFeed.didBackupHead, true, "Wait, I don't think the fetching from head works!");

			FBPost.count({feedId:theFeed.id}, function(err, numberOfPosts){
				if (err) {throw err};
				postsCount = numberOfPosts;

				FBPost.find({feedId:theFeed.id}).sort({postDate:'desc'}).limit(numberOfPostsToDeleteTail).exec(function(err, posts) {
					if (err) {throw err};

					postsIDs = [];

					console.log(">>> Setting Tail");


					for (var i = numberOfPostsToDeleteTail - 1; i >= 0; i--) {
						postsIDs.push(posts[i].postId);
						console.log(posts[i]);
						posts[i].remove();
					};

					console.log(">>> Tail posts removed");
					// Now that posts are deleted let's run the fetch tail method
					fetchTail(theFeed);
				});
			});
		});
	}

	function fetchTail(feed){
		job.data.feedID = feed.id;
		fbBgWorker.launchFeedBackup(job, queue, assertTail);
	}

	function assertTail(){
		FBFeed.findOne({id: feed.id}).exec(function(err, theFeed){
			var wasWithin1second = (Date.now() - theFeed.lastBackup < 1000)?true:false;

			assert.equal(wasWithin1second, true, "Update backup time");

			FBPost.find({feedId:theFeed.id}).sort({postDate:'desc'}).limit(numberOfPostsToDeleteTail).exec(function(err, posts) {
				if (err) {throw err};



				for (var i = numberOfPostsToDeleteTail-1; i >= 0; i--) {
					assert.equal(posts[i].postId, postsIDs[numberOfPostsToDeleteTail-1-i], "Something strange here, the page was not completly restored");
				}

				FBPost.count({feedId:theFeed.id}).exec(function(err, numberOfPosts){
					if (err) {throw err};

					console.log(numberOfPosts);
					console.log(postsCount);

					assert.equal(numberOfPosts, postsCount, "Looks like we did take too few/many posts!");

					console.log("Tail looks good. let's try to see the tail now");

					console.log(">>> Congratz! All tests passed");
					done()
				});
			});
		});	
	}
}

require('test').run(hello)

