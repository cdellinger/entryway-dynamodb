# Entryway-DynamoDB

This project provides a node module that allows you to persist user data to [Amazon's DynamoDB](https://aws.amazon.com/dynamodb/) via the [Entryway](https://github.com/cdellinger/entryway) authentication module.

##Installation
###Core Module

After installing [Entryway](https://github.com/cdellinger/entryway), this module can be installed as follows: 

    npm install entryway-dynamodb


##Usage

In order to use this project, you need to first [create a DynamoDB account](https://aws.amazon.com/dynamodb/getting-started/).

##Configuration
You must provide two configuration values as environmental variables in order for this project to work successfully.  These two values are as follows

	ENTRYWAY_DYNAMODB_REGION
	ENTRYWAY_DYNAMODB_ENDPOINT


#####ENTRYWAY_DYNAMODB_REGION
This is the identifier of the region that you created your DynamoDB within.  

#####ENTRYWAY_DYNAMODB_ENDPOINT
This is https endpoint provided by Amazon when you created your DynamoDB instance.

###Code Examples
There is not any code that is specific to this particular module in order to support DocumentDB.  All you need to do is pass a provider object based upon this module into Entryway as shown below.

	var UserSchema = require('entryway');
	var provider = require('entryway-dynamodb');
	var user = new UserSchema(provider);
	...


Beyond that all the interaction with Entryway is exactly the same as with other Entryway providers, examples which can be seen [here](https://github.com/cdellinger/entryway).
