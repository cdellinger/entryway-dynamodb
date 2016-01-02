/*jslint node: true */
"use strict";

var DynamoDBProvider = function(){

	var AWS = require("aws-sdk");
	AWS.config.update({region: process.env.ENTRYWAY_DYNAMODB_REGION, endpoint: process.env.ENTRYWAY_DYNAMODB_ENDPOINT});
	var dynamodb = new AWS.DynamoDB.DocumentClient();

	var internalDelimiter = '#:#';

	var bcryptjs = require('bcryptjs');
	var uuid = require('uuid');


	var _create = function(user, cb){
		_validateNewUser(user, function(err, validation){
			if (err) return cb(err, null);


			user.id = uuid.v4();
		    dynamodb.put({TableName: 'users', Item: user}, function(err2, data) {
		    	if (err2) return cb(err2, null);
		    	// save strategies off to to strategy table until DynamoDB can support queries against
		    	// internal json structure
		    	var strategy = {};
		    	strategy.key = _createStrategyKey(user.tenant, user.strategies[0].id, user.strategies[0].type);
		    	strategy.id = user.strategies[0].id;
		    	strategy.type = user.strategies[0].type;
		    	strategy.userId = user.id;
		    	strategy.tenant = user.tenant;
		    	strategy.token = user.strategies[0].token;
		    	dynamodb.put({TableName: 'strategies', Item: strategy}, function(err3, data3){
		    		if (err3) return cb(err3, null);
			    	return cb(null, true);
		    	});
		    });
		});
	},

	_createStrategyKey = function(tenant, strategyId, strategyType){
		var key = '';
		if (tenant !== undefined && tenant !== '') key += tenant + internalDelimiter;
		key += strategyId + internalDelimiter + strategyType;
		return key;
	},

	_deleteStrategy = function(strategies, position, cb){
		var params = {
		    TableName:'strategies',
		    Key:{
		        'key':strategies[position].key
		    }
		};
		dynamodb.delete(params, function(err, data) {
		    if (err) return cb(err, null);
			if (position + 1 >= strategies.length){
				return cb(null, true);
			}
			else{
				_deleteStrategy(strategies, position+1, cb);
			}
		});
	},

	_findByUserHandle = function(userHandle, tenant, cb){
		var params = {
		    TableName : "users",
		    IndexName: 'userHandle-index',
		    KeyConditionExpression: "#userHandle = :userHandle",
		    ExpressionAttributeNames:{
		        "#userHandle": "userHandle"
		    },
		    ExpressionAttributeValues: {
		        ":userHandle": userHandle
		    }
		};

		dynamodb.query(params, function(err, data) {
			if (err) return cb(err, null);
			if (data.Items[0] === undefined){
				return cb(null, undefined);
			}
			var matchIndex = -1;
			for (var x=0;x<data.Items.length;x++){
				if (data.Items[x].tenant === tenant){
					matchIndex = x;
					break;
				}
			}
			if (matchIndex === -1){
				return cb(null, undefined);
			}
			else{
				return cb(null, data.Items[matchIndex]);
			}
		});
	},

	_getById = function(id, user, cb){
		var params = {
		    TableName : "users",
		    KeyConditionExpression: "#id = :id",
		    ExpressionAttributeNames:{
		        "#id": "id"
		    },
		    ExpressionAttributeValues: {
		        ":id": id
		    }
		};

		dynamodb.query(params, function(err, data) {
		    if (err) return cb(err, null);
			if (data.Items[0] !== undefined){
				for (var s in data.Items[0]){
					if (s !== 'provider'){
						user[s] = data.Items[0][s];				
					}
				}
				return cb(null, true);			
			}
			else{
				user.init();
				return cb(null, false);
			}
		});
	},

	_getByStrategy = function(strategyType, strategyId, tenant, user, cb){
		_getByStrategyPrivate(strategyType, strategyId, tenant, function(err, userData){
			if (err) return cb(err, null);
			if (userData === undefined){
					user.init();
		    		return cb(null, false);				
			}
			else{
				_getById(userData.userId, user, cb);
			}
			/*
			if (userData !== undefined){
				for (var s in userData){
					user[s] = userData[s];
				}				
			}
			return cb(null, true);			
			*/
		});
	},

	_getByStrategyPrivate = function(strategyType, strategyId, tenant, cb){
		var params = {
		    TableName : "strategies",
		    KeyConditionExpression: "#key = :generatedKey",
		    ExpressionAttributeNames:{
		        "#key": "key"
		    },
		    ExpressionAttributeValues: {
		        ":generatedKey": _createStrategyKey(tenant, strategyId, strategyType)
		    }
		};

		dynamodb.query(params, function(err, data) {
		    if (err) {
		        console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
		    } else {
		    	if (data.Items[0] !== undefined){
		    		return cb(null, data.Items[0]);
		    	}
		    	else{
		    		return cb(null, undefined);
		    	}
		    }
		});
	},

	_isStrategyInUse = function(strategyType, strategyID, tenant, cb){
		_getByStrategyPrivate(strategyType, strategyID, tenant, function(err, strategyMatch){
			if (err) return cb(err, null);
			if (strategyMatch === undefined){
				return cb(null, false);
			}
			else{
				return cb(new Error('This strategy is already in use'), null);
			}
		});
	},

	_passwordLogin = function(userHandle, password, tenant, user, cb){
		_getByStrategyPrivate('LOCAL', userHandle, tenant, function(err, results){
			if (err) return cb(err, null);
			if (results === undefined) return cb(null, false);
			if (bcryptjs.compareSync(password, results.token)){
				_getById(results.userId, user, cb);
			}
			else{
				return cb(null, false);			
			}
		});	
	},

	_remove = function(user, cb){
		var params = {
		    TableName : "strategies",
		    IndexName: 'userId-index',
		    KeyConditionExpression: "#userId = :userId",
		    ExpressionAttributeNames:{
		        "#userId": "userId"
		    },
		    ExpressionAttributeValues: {
		        ":userId": user.id
		    }
		};

		dynamodb.query(params, function(err, data) {
			if (err) return cb(err, null);
			_deleteStrategy(data.Items, 0, function(err2, data2){
				if (err2) return cb(err2, null);
				var params = {
				    TableName:'users',
				    Key:{
				        'id':user.id
				    }
				};
				dynamodb.delete(params, cb);
			});
		});
	},

	_strategyLogin = function(userHandle, strategyType, accessToken, tenant, user, cb){
		var params = {
		    TableName : "strategies",
		    KeyConditionExpression: "#key = :generatedKey",
		    ExpressionAttributeNames:{
		        "#key": "key"
		    },
		    ExpressionAttributeValues: {
		        ":generatedKey": _createStrategyKey(tenant, userHandle, strategyType)
		    }
		};


		dynamodb.query(params, function(err, data) {
		    if (err) {
		        console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
		    } else {
		    	if (data.Items[0] !== undefined){
					if (data.Items[0].token !== accessToken){
						// need to update token
						_getById(data.Items[0].userId, user, function(err2, results){
							if (err2) return cb(err2, null);
							for (var x=0;x<user.strategies.length;x++){
								if (user.strategies[x].type === strategyType){
									user.strategies[x].token = accessToken;
								}
							}
							user.save(cb);
						});
					}
					else{
						_getById(data.Items[0].userUid, user, cb);
					}
		    	}
		    	else{
					user.init();
		    		return cb(null, false);
		    	}
		    }
		});
	},

	_update = function(user, cb){
		//made business rule that you cannot update tenant or id
		var updateExpression = 'set userHandle = :userHandle';
		var removeExpression = '';
		var expressionAttributeValues = {};
		expressionAttributeValues[':userHandle'] = user.userHandle;

		if (user.email !== undefined){
			updateExpression += ', email = :email';
			expressionAttributeValues[':email'] = user.email;			
		}
		else{
			removeExpression += 'email, ';
		}

		if (user.location !== undefined){
			updateExpression += ', #loc = :location';
			expressionAttributeValues[':location'] = user.location;
		}
		else{
			removeExpression += '#loc, ';
		}

		if (user.fullName !== undefined){
			updateExpression += ', fullName = :fullName';
			expressionAttributeValues[':fullName'] = user.fullName;
		}
		else{
			removeExpression += 'fullName, ';
		}

		if (user.bio !== undefined){
			updateExpression += ', bio = :bio';
			expressionAttributeValues[':bio'] = user.bio;
		}
		else{
			removeExpression += 'bio, ';
		}

		if (user.avatar !== undefined){
			updateExpression += ', avatar = :avatar';
			expressionAttributeValues[':avatar'] = user.avatar;
		}
		else{
			removeExpression += 'avatar, ';
		}


		if (removeExpression !== ''){
			updateExpression += ' REMOVE ' + removeExpression.substring(0, removeExpression.length - 2);
		}



		var params = {
		    TableName:'users',
		    Key:{
		        "id": user.id
		    },
		    UpdateExpression: updateExpression,
		    ExpressionAttributeValues: expressionAttributeValues,
		    ExpressionAttributeNames: {
     			"#loc" : "location"
        	},
		    ReturnValues:"UPDATED_NEW"
		};

		dynamodb.update(params, cb);
	},

	_validateAddingNewStrategy = function(strategyType, userHandle, user, cb){
		if (user.strategies.length > 0 && user.id === '') return cb(new Error('An unpersisted user cannot have more than one strategy'), null);
		for (var x=0;x<user.strategies.length;x++){
			if (user.strategies[x].type === strategyType){
				return cb(new Error('A user cannot have two strategies of the same type'), null);
			}
		}
		_isStrategyInUse(strategyType, userHandle, user.tenant, function(err, results){
			if (err) return cb(err, null);
			return cb(null, true);
		});
	},

	_validateNewUser = function(user, cb){
		_validateSchema(user, function(err, validation){
			if (err) return cb(err, null);

			if (user.strategies.length > 1){
				return cb(new Error('New users can only have one strategy'), null);
			}
			_findByUserHandle(user.userHandle, user.tenant, function(err, results){
				if (err) return cb(err, null);
				if (results === undefined){
					_isStrategyInUse(user.strategies[0].type, user.strategies[0].id, user.tenant, function(errStrategyInUse, strategyMatch){
						if (errStrategyInUse) return cb(errStrategyInUse, null);
						return cb(null, true);
					});
				}
				else{
					return cb(new Error('User exists already with this user handle'), null);
				}
			});
		});		
	},

	_validateSchema = function(user, cb){
		//if (self.docType === undefined) return cb(new Error('docType property has been removed, it is required'), null);
		if (user.userHandle === undefined) return cb(new Error('userHandle property has been removed, it is required'), null);
		if (user.userHandle === '') return cb(new Error('userHandle must have a value'), null);

		if (user.strategies === undefined) return cb(new Error('strategies collection has been removed, it is required'), null);
//TODO COME BACK AND ADD THIS ON
		//if (self.strategies.length === 0) return cb(new Error('At least one strategy is required'), null);

		//if (self.tenant === undefined) return cb(new Error('tenant property has been removed, it is required'), null);
		return cb(null, true);
	};

	return {
		create: _create,
		getById: _getById,
		getByStrategy: _getByStrategy, 
		passwordLogin: _passwordLogin,
		remove: _remove,
		strategyLogin: _strategyLogin,
		update: _update,
		validateAddingNewStrategy: _validateAddingNewStrategy
	};
}();
module.exports = DynamoDBProvider;


