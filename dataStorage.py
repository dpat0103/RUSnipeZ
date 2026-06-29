import json
#user_data contains all the discord userID's along with their snipe list and all the indexs inside of that
user_data = {}


def saving_user_data(user_data):
    '''
    This function is responsible for storing any inputted data into the json file which is our database.
    '''
    
    user_data_copy = user_data.copy()
    #the user_id is the key and data is the value based on the input dictionary being valid or not
    for user_id, data in user_data_copy.items():
        #setup the data in correct format
        data['sniped_classes'] = list(data['sniped_classes'])
    #dump the updated user data into the json filevia writing to file.
    try:
        with open('user_data.json', 'w') as file:
            json.dump(user_data_copy, file, indent=4)
    except Exception as e:
        print(f"Error saving user data: {str(e)}")



def load_user_data():
    '''
    This function is responsible for reading in user_data from a json file when called. 
    '''
    try:
        with open('user_data.json', 'r') as file:
            data = file.read()
            if data:
                return json.loads(data)
            else:
                return {}
    except FileNotFoundError:
        return{}
        
#Read the most current user data on startup of the bot.
user_data = load_user_data()
