var fs = require('fs');
var os = require('os');
var path = require('path');

var mongoose = require('mongoose');

exports.index = function(req, res){
	res.render('index', { title: 'Alghayma' });
};
