angular.module('timeline', [])

.controller('TimelineCtrl', ['$scope', 'PostService', function($scope, PostService) {
	var feedId = 537011102992127, offset= 1;
	$scope.posts = PostService.get(feedId, offset).
	success(function(res){
		console.log("test");
		console.log(res);
	});
}])

.service('PostService', ['$http', function($http){
	return{
		get: function(feedId, offset){
			return $http.get('/fb/chunk?feedId=' + feedId + '&offset=' + offset);
		}
	};
}]);
