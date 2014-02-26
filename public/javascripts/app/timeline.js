angular.module('timeline',[])

.controller('TimelineCtrl', ['$scope', 'PostService', '$timeout', '$rootScope','$filter', function($scope, PostService, $timeout, $rootScope, $filter) {

	var feedId = angular.copy(window.feedId),
	dateStr = angular.copy(window.dateStr),
	profileImage = angular.copy(window.profileImage);

	$scope.posts = [];
	$scope.offset = 0;
	$scope.profileImage = profileImage;

	// TODO refactor this part, jquery logic in angular -> BAD
	if (typeof dateStr != 'undefined'){
		var formattedDateStr = $filter('formatDate')(dateStr);
		angular.element('#feedDescription')[0].textContent = angular.element('#feedDescription')[0].textContent.replace('{[lastBackupDate]}', formattedDateStr);
	}

	var getPost = function(id , offset, callback){
		PostService.get(feedId, offset).
		success(function(res){

			// The server returns an array of object
			for(var i=0; i < res.length; i++){
				$scope.posts.push(res[i]);
			}

			if (callback && typeof callback == 'function'){callback();}
		});
	};

	// Initial load of the data
	getPost(feedId, $scope.offset, function(){
		$scope.offset = 1;
	});

	$rootScope.$on('fetchMorePosts', function(e){
		getPost(feedId, $scope.offset, function(){
			$scope.offset += 1;
		});
	});

}])

.controller('MessageCtrl', ['$scope', 'BackupService', '$window', '$timeout', function($scope, BackupService, $window, $timeout){

	var getSearchKey = function(keyName){
		return decodeURI($window.location.search.replace(new RegExp("^(?:.*[&\\?]" + encodeURI(keyName).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));
	};

	var redirectAfterRequest = function(){
		$timeout(function(){
			for (var i = 5; i >= 0; i--) {
				$scope.message = 'Redirecting to Alghayma homepage in ' +
				(i).toString() +
				' seconds. If it doesn\'t, click <a href="/">here</a>.';
			}
			if(i === 0) {$window.history.back();}
		}, 1000);
	};

	$scope.backUpRequest = function(){

		BackupService.post(getSearchKey('sourceUrl')).
		success(function(){
			$scope.response = { "type": "success", "message": "Your request was saved in Alghayma and will be backed up soon"};
		}).
		error(function(data, status){
			$scope.response = { "type": "error", "message": "Sorry, an error occured"};
		});

		redirectAfterRequest();
	};
}])

.directive('infinityScroll', ['$rootScope', function($rootScope){

	return {
		link: function(scope, el, attrs) {

			el.bind('mouseenter onmouseclick', function(){
				$rootScope.$emit('fetchMorePosts');
			});

			var windowEl = $(window); // Can't call $window to avoid conflict with angularjs

			// Triggers the infinite scroll if at the bottom of the page
			windowEl.scroll(function(e){
				if((windowEl.height() + windowEl.scrollTop()) === $(document).height()){
					$rootScope.$emit('fetchMorePosts');
				}
			});
		}
	};
}])

.directive('post', ['$timeout', 'TimelineService', function($timeout, TimelineService){

	return {
		link: function(scope, el, attrs) {

			var index = parseInt(attrs.postIndex, 10),
				last = attrs.postLast,
				positionClass = '';

			TimelineService.addPost(el);

			// Only perform the rerendering after the last ng-repeat
			if(last === 'true'){
				$timeout(function(){
					TimelineService.formatUI();
				});
			}

		}
	};
}])

.filter('formatDate', function(){
	return function(dateStr) {
		var date = new Date(dateStr);
		return 'on ' + date.getDate() + '-' + (date.getMonth() + 1) + '-' + date.getFullYear() + ', at ' + date.getHours() + ':' + (date.getMinutes().toString().length == 1 ? '0' + date.getMinutes().toString() : date.getMinutes());
		}; //That last part prevents from getting timestamps such as 15:0
})

.service('TimelineService', [function(){

	var postList = []; // Contains all the cached DOM elements of the timeline

	return {

		addPost: function(post){
			postList.push(post);
		},
		formatUI: function(){

			var leftColumnSize=0,
			rightColumnSize = 0,
			positionClass = '';

			// For instead of angular.forEach for speed reasons
			for (var i = 0; i<postList.length; i++) {
				// First one on the left
				if(i === 0){
					leftColumnSize += postList[i][0].offsetHeight;
					positionClass = 'left';
				// Second one on the right
				} else if(i === 1){
					rightColumnSize += postList[i][0].offsetHeight;
					positionClass = 'right';
				} else {
					if(rightColumnSize > leftColumnSize ){
						positionClass='left';
						leftColumnSize += postList[i][0].offsetHeight;
					} else{
						positionClass='right';
						rightColumnSize += postList[i][0].offsetHeight;
					}
				}
				postList[i].addClass(positionClass);
			}
			postList = []; // reset to avoid formatting the previous posts
		}

	};

}])

.service('BackupService', ['$http', function($http){

	return{
		post: function(sourceUrl){
			return $http({
				method: 'POST',
				url: '/fb/backup/',
				header:{
					'enctype': 'application/x-www-form-urlencoded'
				},
				data:{
					'sourceUrl': sourceUrl
				}
			});
		}
	};
}])

.service('PostService', ['$http', function($http){
	return{
		get: function(feedId, offset){
			return $http.get('/fb/chunk?feedId=' + feedId + '&offset=' + offset);
		}
	};
}]);

