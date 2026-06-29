import csv
import requests
from manipulatingdata import data_dict
from utils import get_est_timestamp
import json



response = requests.get("https://classes.rutgers.edu/soc/api/openSections.json?year=2025&term=1&campus=NB")

'''
API response of indexes
Loop through each index in list of indexes that are currently open
if index is already in last_open dictionary, change last open date to right now
if index is not in last_open dictionary, add it into last_open and put last open date as right now

'''
def setup_open_sections_dict_best(api_response_content, data_dict):
    open_sections_dict = {}
    response_data = api_response_content.text
    response_data_list = json.loads(response_data)
    file = 'last_opened_sections.csv'
    with open(file, 'r') as csv_file:
        csv_reader = csv.reader(csv_file)
        next(csv_reader)

        for row in csv_reader:
            index, last_opened = row
            open_sections_dict[index] = last_opened
    
    for index in response_data_list:
        if index in data_dict.keys():
            open_sections_dict[index] = get_est_timestamp()


    with open(file, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Index', 'Last Opened Date'])
        for key, value in open_sections_dict.items():
            writer.writerow([key, value])



def generate_updated_last_opened_date_dict():
    last_opened_sections_dict = {}

    with open('last_opened_sections.csv', 'r') as csv_file_2:
        csv_reader = csv.reader(csv_file_2)
        next(csv_reader)

        for row in csv_reader:
            index, last_opened = row
            last_opened_sections_dict[index] = last_opened
    return last_opened_sections_dict
        
