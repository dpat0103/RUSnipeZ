from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from bs4 import BeautifulSoup
import time
import csv
import os
from datetime import datetime

def generate_date():
    '''
    This function generates the current date
    '''
    current_date = datetime.now().date()
    return current_date


def delete_html_files():
    '''
    This function selectively deletes all html files that were generated when scraping for course information
    '''
    for code in school_codes:
        input_html_file = f'scraped_output_{code}.html' 
        os.remove(input_html_file)
    print("HTML files deleted.")

def clear_csv_file(output_file):
    '''
    This function clears the csv output file in order to prepare for new additions.
    '''
    with open(output_file, 'w', newline='', encoding='utf-8') as csv_file:
        csv_file.truncate(0)
    print("CSV file cleared.")

#Clear csv file prior to utilizing it.
clear_csv_file("finalized_file.csv")


def scrape_and_save_html(url, output_file, wait_time=10):
    '''
    This function utilizes Selenium in order to scrape the Rutgers Schedule of Classes website for html code for each Rutgers school's course listing information.

    Parameters:
        url: the url to the specified school's course listings on that webpage.
        output_file: the file that will the html code will be stored into. 
    '''

    #insert full chrome driver path here. Ensure the driver is put in the same directory as this code file.
    chromedriver_path = r'Insert Path Here'  
    
    #Selenium essentials in order for it to run
    service = Service(chromedriver_path)
    driver = webdriver.Chrome(service=service)
    driver.get(url)
    
    #There is a 10 second wait period before the page is closed in order for the data to be adequately loaded so that it can be scraped in one go.
    print(f"Waiting for {wait_time} seconds...")
    time.sleep(wait_time)
    
    html_content = driver.page_source
    
    #Save the content into a corresponding html file based on the school code.
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print(f"HTML content saved to {output_file}")
    
    driver.quit()




def extract_class_info(class_soup):
    '''
    This function utilizes BeautifulSoup in order to find just the right information we need in html code.
    We want to get the Course Title, the Course Code, and all of the sections of the course that are being taught this semester
    '''
    course_name = class_soup.find('span', class_='courseTitle').text.strip()
    course_code = class_soup.find('span', id=lambda x: x and x.startswith("courseId")).text.strip()
    
    sections = class_soup.find_all('div', class_='section')
    
    class_info_list = []
    
    for section in sections:
        course_section = section.find('span', class_='sectionDataNumber').text.strip()
        course_index = section.find('span', class_='sectionIndexNumber').text.strip()
        class_info_list.append([course_name, course_code, course_section, course_index])

    return class_info_list
print("Course info extracted!")



def parse_html_to_csv(input_file, output_file):
    '''
    This function is responsible for adding courses into the CSV from html files that were previously scraped via Selenium.
    '''
    #Open the html file that is the input file, and read it in. 
    with open(input_file, 'r', encoding='utf-8') as file:
        html_content = file.read()



    soup = BeautifulSoup(html_content, 'html.parser')
    #This finds the specific elements we are looking for in the html code.
    class_elements = soup.find_all('div', class_='courseItem')

    with open(output_file, 'a', newline='', encoding='utf-8') as csv_file:
        csv_writer = csv.writer(csv_file)

        is_empty = csv_file.tell() == 0

        if is_empty:
            csv_writer.writerow(['Course Name', 'Course Code', 'Section', 'Index'])

        for class_element in class_elements:
            class_info_list = extract_class_info(class_element)
            for class_info in class_info_list:
                csv_writer.writerow(class_info)

#Get a date of run and a new csv file to be used for storing all the updated course information
date_stamp = generate_date()
output_csv_file = f'finalized_file_{date_stamp}.csv'


comm = input("Enter CLEAR or RUN: ")
if comm == "CLEAR" :
    #school_codes are all the corresponding schools in Rutgers that we will be scraping one by one. 
    school_codes = ['01', '03', '04', '05', '07', '09', '10', '11', '13', '14', '19', '30', '33', '37', '77']
    delete_html_files()
elif comm == "RUN":
    school_codes = ['01', '03', '04', '05', '07', '09', '10', '11', '13', '14', '19', '30', '33', '37', '77']

    
    for code in school_codes:
        print(f"Currently scraping school: {code}")
        output_file = f"scraped_output_{code}.html"
        url = f"https://classes.rutgers.edu/soc/#school?code={code}&semester=12025&campus=NB&level=U"
        scrape_and_save_html(url, output_file)

    for code in school_codes:
        print(f"Currently parsing school: {code}")
        input_html_file = f'scraped_output_{code}.html' 
        parse_html_to_csv(input_html_file, output_csv_file)


    delete_html_files()
else:
    print("Retry and enter a valid command")