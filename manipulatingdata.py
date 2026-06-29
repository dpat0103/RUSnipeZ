import csv



data_dict = {}

'''
When the bot is restarted or turned on again, we need to reread the values of the csv file that contains all course information.
We store these values in data_dict.
The data_dict key will be the index of a course and its values will be a dictionary that contains the course title, course code, and section 
'''
with open('finalized_file_2024-12-25.csv', 'r') as csv_file:
    csv_reader = csv.reader(csv_file)
    next(csv_reader)  # Skip the header row if it exists



    for row in csv_reader:
        title, course_code, section, index = row
        data_dict[index] = {
            'Title': title,
            'Course Code': course_code,
            'Section': section
        }



'''
When the bot is restarted or turned on again, we need to reread the values of the csv file that contains information of when a section of any course was last opened.
We store these values in last_opened_sections_dict.
The last_opened_sections_dict key will be the index of course section, and its corresponding value will be the last opened date on record.
'''

last_opened_sections_dict = {}

with open('last_opened_sections.csv', 'r') as csv_file_2:
    csv_reader = csv.reader(csv_file_2)
    next(csv_reader)  # Skip the header row if it exists

    for row in csv_reader:
        index, last_opened = row
        last_opened_sections_dict[index] = {
            'Last Opened Date': last_opened
        }

print(last_opened_sections_dict)