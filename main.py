import discord
from discord.ext import commands, tasks
import requests
from discord import app_commands, Interaction
from dataStorage import load_user_data, saving_user_data, user_data
from utils import generate_new_log, dump_to_log_file, get_est_timestamp
from last_opened import setup_open_sections_dict_best, generate_updated_last_opened_date_dict
import datetime
from manipulatingdata import data_dict
from discord.ui import Button
import aiohttp
import asyncio
import time
import random



#Basic Discord essentials to run bot
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
bot = commands.Bot(command_prefix='/', intents=intents)


#most recently updated link for accessing the webreg system for users to login after a class has opened up
registration_link = 'https://sims.rutgers.edu/webreg/editSchedule.htm?login=cas&semesterSelection=12025&indexList='
cooldowns = {}


@bot.tree.command(name='testdm', description='test to see if priv dm pings work')
async def testdm(interaction: Interaction, index: str):
    '''
    This async function is responsible for simulating a notification of what should be expected as the output when a section is open. 
    This function is solely for testing purposes to ensure the bot and all of its functionalites are up to date and running. 
    '''
    for user_id in user_data:
        user = await bot.fetch_user(user_id)
        print(user)
    if user_id not in user_data:
        user_data[user_id] = {
            'sniped_classes': set(),
        }
    response = requests.get("https://classes.rutgers.edu/soc/api/openSections.json?year=2025&term=1&campus=NB")
    open_sections = response.json()
    title = data_dict.get(index, {}).get('Title', 'Title not found')
    section = data_dict.get(index, {}).get('Section', 'Section not found')
    
    embed = discord.Embed()

    if index in open_sections:
        embed.title = f"{title} {section} is now open!"
        embed.description = f"Course Index: {index}"
        embed.color = discord.Color.green()
        button = Button(style=discord.ButtonStyle.url, label="Register", url=registration_link + index)
        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        embed.set_thumbnail(url="attachment://logo.png")  
        timestamp = get_est_timestamp()
        embed.set_footer(text=timestamp)

        avatar_url = interaction.user.avatar.url if interaction.user.avatar else interaction.user.default_avatar.url
        embed.set_author(name=interaction.user.display_name, icon_url=avatar_url)
        message = f"{user.mention}!"
        dm_channel = user.dm_channel
        if dm_channel is None:
            dm_channel = await user.create_dm()
        await dm_channel.send(content=message, embed=embed, file=file,view=discord.ui.View().add_item(button) )


@bot.tree.command(name='sample', description='sample notification')
async def sample(interaction: Interaction):
    '''
    This async function is responsible for simulating a notification of what should be expected as the output when a section is open. 
    This function is solely for testing purposes to ensure the bot and all of its functionalites are up to date and running. 
    '''
    user_id = str(interaction.user.id)
    response = requests.get("https://classes.rutgers.edu/soc/api/openSections.json?year=2025&term=1&campus=NB")
    open_sections = set(response.json())
    selected_index = random.choice(list(open_sections))
    print(selected_index)

    index = str(selected_index)
    title = data_dict.get(index, {}).get('Title', 'Class Title Not Found')
    section = data_dict.get(index, {}).get('Section', 'Class Section Not Found')
    days = data_dict.get(index, {}).get('Days', 'Days Not Found')
    prof = data_dict.get(index, {}).get('Professor', 'Professor Not Found')


    embed = discord.Embed()
    embed.title = f"{title} is now open! TEST"
    embed.description = f"**Section {section}** at `{index}`  \n  **Professor:** {prof} \n   **Days:** {days}"
    button_register = discord.ui.Button(style=discord.ButtonStyle.url, label="Register", url=registration_link + index)
    embed.color = discord.Color.green()
    file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
    embed.set_thumbnail(url="attachment://logo.png")  
    timestamp = get_est_timestamp()
    embed.set_footer(text=timestamp)
    message = f"Hey {interaction.user.mention}, {title} {section} has opened!"
    await interaction.response.send_message(embed=embed, file=file, view=discord.ui.View().add_item(button_register), ephemeral=True)



      
@bot.event
async def on_ready():
    '''
    This async function is called on successful startup of the bot. This is solely for ensuring it us up and running alongside all of the other services required. 
    '''
    user_data = load_user_data()
    print('RU SnipeZ is online and connected to Discord!')
    check_open_classes.start()
    check_last_opened.start()
    synced = await bot.tree.sync()
    print(len(synced))

@bot.event
async def on_member_join(member):
    '''
    This async function is called to provide a personalzied message on the Discord server when a new user joins the server. It provides onboarding information to that user. 
    '''
    role = discord.utils.get(member.guild.roles, name='Member')
    await member.add_roles(role)
    embed = discord.Embed()
    embed.title = f"Welcome to RU SnipeZ, {member.display_name}!"
    embed.description = "We are glad you joined us! Happy Sniping :)\nPlease refer to the [get started](https://discord.com/channels/1187974778343149699/1188377000688242719) channel for more information!\nQuestions? Check out the [faq](https://discord.com/channels/1187974778343149699/1188377031491211274) channel!"
    embed.set_thumbnail(url=member.avatar)
    timestamp = get_est_timestamp()
    embed.set_footer(text=timestamp)
    embed.color = discord.Color.blue()
    channel_id = 1188255481056219217
    channel = bot.get_channel(channel_id)
    await channel.send(embed=embed)
    print(f"{member.name} has joined the server.")


@tasks.loop(seconds=1)
async def check_open_classes():
    '''
    This async function is called to continously monitor indexes that Users have stored in their snipe list, for any openings and send alert to corresponding functions based on execution.
    '''

    #Response request is set to the Schedule of Classes Api to obtain a dictionary containing all of the indexes of all current open course sections in their database
    response = requests.get("https://classes.rutgers.edu/soc/api/openSections.json?year=2025&term=1&campus=NB")

    #We cast the json response dictionary as a set, for easy lookup and access without duplicates
    open_sections = set(response.json())
    tasks = []

    #Populating the user_ids of all users we have in our database.
    user_ids = list(user_data.keys())

    #Loop over these user id's and get their corresponding snipe list and do a set operation to determine if an index in their snipe list is in the current open sections set.
    for user_id in user_ids:
        sniped_classes = user_data[user_id]['sniped_classes']
        sniped_classes_set = set(sniped_classes)

        common_classes = sniped_classes_set & open_sections

        #if a match is found, we want to prepare this user to be processed for notification via the bot and ad it to the task list.
        if common_classes:
            user = await bot.fetch_user(user_id)
            if user:
                for index in common_classes:
                    #The user must not have a cooldown already, which would remove them from processed for notification instantly, and rather put them in a queue to be notified after a set span of time.
                    if not is_on_cooldown(user_id, index):
                        task = process_user(user, index)
                        tasks.append(task)
                        set_cooldown(user_id, index)

    await asyncio.gather(*tasks)



@tasks.loop(seconds=5)
async def check_last_opened():
    '''
    This async function is monitoring the Schedule of Classes API every 5 seconds and populating a updated dictionary used for checking when a class was last opened.
    '''
    response = requests.get("https://classes.rutgers.edu/soc/api/openSections.json?year=2025&term=1&campus=NB")

    #see last_oepned.py for more information pertaining to this functions logic
    setup_open_sections_dict_best(response, data_dict)



@bot.tree.command(name='lastopen', description='Get insight on when a specific course was last open via courese index')
async def last_open(interaction : discord.Interaction, index : str):
    '''
    This function is responsible returning a embed to the discord user about a specific course section's last open date and time. 
    '''

    #grab the most latest dictionary of last opened classes (which is generated every 5 seconds)
    last_opened_dict = generate_updated_last_opened_date_dict()

    #if the specified index by the user, we want to pull the last open time from the last_opened_dict and put it in the embed and return it to the user
    if index in last_opened_dict.keys():
        embed = discord.Embed()
        title = data_dict.get(index, {}).get('Title', 'Class Title Not Found')
        section = data_dict.get(index, {}).get('Section', 'Class Section Not Found')
        embed.title = f"Last open: {last_opened_dict[index]}!"
        embed.description = f"Course Name: `{title}`\n Section: `{section}`"
        embed.color = discord.Color.green()
        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        embed.set_thumbnail(url="attachment://logo.png")
        timestamp = get_est_timestamp()
        embed.set_footer(text=timestamp)
        await interaction.response.send_message(embed=embed, file=file, ephemeral=True)
    #if index match is unsucecssful, return an embed regardless and notify that the last open date and time is unknown.
    else:
        embed = discord.Embed()
        title = data_dict.get(index, {}).get('Title', 'Class Title Not Found')
        section = data_dict.get(index, {}).get('Section', 'Class Section Not Found')
        embed.title = f"Last open: Unknown!"
        embed.description = f"Course Name: `{title}`\n Section: `{section}`"
        embed.color = discord.Color.green()
        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        embed.set_thumbnail(url="attachment://logo.png")
        timestamp = get_est_timestamp()
        embed.set_footer(text=timestamp)
        await interaction.response.send_message(embed=embed, file=file, ephemeral=True)






'''
These functions are utilized in the process of determing whether to instantly notify a user or limit the notification depending on situations.
This is useful for ensuring the user is not spammed or too many API calls are not made unecessarily. 
'''
def is_on_cooldown(user_id, index):
    '''
    This function is responsible for determing if a user currently has a cooldown or not.
    '''
    cooldown_key = f"{user_id}_{index}"
    return cooldowns.get(cooldown_key, 0) > time.time()

def set_cooldown(user_id, index, cooldown_duration=600):
    '''
    This function is responsible for setting a cooldown of 10 minutes for a specified user_id.
    '''
    cooldown_key = f"{user_id}_{index}"
    cooldowns[cooldown_key] = time.time() + cooldown_duration



async def process_user(user, index):
    '''
    This async function is executed when a user has a index in their snipe list, which is now open based on the response from the API. 
    This user is then processed and sent out a embed for the notification of the course section opening along with a registration link.
    '''
    embed = discord.Embed()
    notified_classes = set()
    title = data_dict.get(index, {}).get('Title', 'Class Title Not Found')
    section = data_dict.get(index, {}).get('Section', 'Class Section Not Found')
    embed.title = f"{title} is now open!"
    embed.description = f"**Section {section}** at `{index}`"
    button_register = discord.ui.Button(style=discord.ButtonStyle.url, label="Register", url=registration_link + index)
    embed.color = discord.Color.green()
    file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
    embed.set_thumbnail(url="attachment://logo.png")  
    timestamp = get_est_timestamp()
    embed.set_footer(text=timestamp)
    message = f"Hey {user.mention}, {title} {section} has opened!"
    user_id = user.id
    
    #if a user is new and doesnt have a dm channel setup with the bot, this will create a new DM channel with the bot for sending notifications.
    dm_channel = user.dm_channel
    if dm_channel is None:
        dm_channel = await user.create_dm()
    
    try:
        await dm_channel.send(content=message, embed=embed, file=file, view=discord.ui.View().add_item(button_register))
    except discord.Forbidden:
        print(f"Failed to send message to {user} due to permissions.")
    
    notified_classes.add(index)
    if index in notified_classes:
        notified_classes.remove(index)
    




@bot.tree.command(name='snipe', description='Snipe a Class')
async def snipe(interaction: discord.Interaction, index: str):
    '''
    This async function execustes when a user wants to add a course section via index, to be monitored for opening.
    '''

    #Get a most up to date version of last opened courses
    last_oepned_dict = generate_updated_last_opened_date_dict()

    #Grab Discord User Id of user who called this command
    user_id = str(interaction.user.id)

    #If the user is not already part of the database, set up a snipe list for them in the database
    if user_id not in user_data:
        user_data[user_id] = {
            'sniped_classes': set(),
        }
    
    #Validate the index that the user requested, by cross checking with the data_dict which stores all the possible course sections that are available for this semseter.
    if index not in data_dict:
        invalid_embed = discord.Embed(
            title="Invalid index!",
            description="Please enter a valid index and try again.",
            color=discord.Color.red()
        )
        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        invalid_embed.set_thumbnail(url="attachment://logo.png")
        timestamp = get_est_timestamp()
        invalid_embed.set_footer(text=timestamp)
        await interaction.response.send_message(embed=invalid_embed, file=file, ephemeral=True)
        print(f"Invalid index request recieved")
        #Log instance of invalid snipe and store log
        log = generate_new_log(timestamp=get_est_timestamp(), log_info=f"Invalid snipe set by {interaction.user}", status_code=400)
        dump_to_log_file(new_data=log)
        return
    print(f"Received /snipe command with index {index}")
    response = requests.get("https://classes.rutgers.edu/soc/api/openSections.json?year=2025&term=1&campus=NB")
    open_sections = response.json()
    title = data_dict.get(index, {}).get('Title', 'Title not found')
    section = data_dict.get(index, {}).get('Section', 'Section not found')
    
    #If valid index, next check if the index matches with records of currently open course sections.
    if index in open_sections:
        embed = discord.Embed(
            title=f"{title} {section} is now open!",
            description=f"Course Index: `{index}` \n Register now!",
            color=discord.Color.green()
        )

        embed.set_thumbnail(url="attachment://logo.png")
        button = Button(style=discord.ButtonStyle.url, label="Register", url=registration_link + index)

        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        timestamp = get_est_timestamp()
        embed.set_footer(text=timestamp)

        avatar_url = interaction.user.avatar.url if interaction.user.avatar else interaction.user.default_avatar.url
        embed.set_author(name=interaction.user.display_name, icon_url=avatar_url)

        #Send notification immediately that section is open to user, without storing the snipe in database.
        await interaction.response.send_message(embed=embed, file=file, view=discord.ui.View().add_item(button), ephemeral=True)
        print(f"Class {index} is currently open!")
    
    #If validated and not currently open, then prepare index to be stored in specified user's snipe list and put it in the database and notify the user of its last open date.
    else:
        if len(index) != 5 or not index.isdigit():  # Corrected the condition
            await interaction.response.send_message("Please enter a valid index and try again.", ephemeral=True)
        elif index in user_data[user_id]['sniped_classes']:
            await interaction.response.send_message(f"You already have an existing snipe for {index}.", ephemeral=True)
        else:
            user_data[user_id]['sniped_classes'].append(index)
            embed = discord.Embed(
                title=f"Snipe set for {title} Section {section}",
                description=f"Course Index: `{index}` \n Last Open Date: `{last_oepned_dict.get(index, 'Unknown')}`",
                color=discord.Color.blue()
            )

            embed.set_thumbnail(url="attachment://logo.png")
            timestamp = get_est_timestamp()
            embed.set_footer(text=timestamp)

            avatar_url = interaction.user.avatar.url if interaction.user.avatar else interaction.user.default_avatar.url
            embed.set_author(name=interaction.user.display_name, icon_url=avatar_url)

            file = discord.File("RU_snipeZ_logo.png", filename='logo.png')

            await interaction.response.send_message(embed=embed, file=file, ephemeral=True)
            print(f"Snipe set by {interaction.user} for {title} at SECTION {section} on INDEX {index}")
            log = generate_new_log(timestamp=get_est_timestamp(), log_info=f"Snipe set by {interaction.user} for {title} at SECTION {section} on INDEX {index}", status_code=200)
            dump_to_log_file(new_data=log)
    #Save all changes to database
    saving_user_data(user_data)

@bot.tree.command(name='remove', description='removes all current snipes')
async def remove(interaction: discord.Interaction, index: str):
    '''
    This async function executes when a user provides a valid index and wants to remove it from their snipe list.
    '''

    #Get the Discord user ID of user who ran the command
    user_id = str(interaction.user.id)

    embed = discord.Embed() 
    embed.color = discord.Color.green()
    avatar_url = interaction.user.avatar.url if interaction.user.avatar else interaction.user.default_avatar.url
    embed.set_author(name=interaction.user.display_name, icon_url=avatar_url)
    timestamp = get_est_timestamp()
    embed.set_footer(text=timestamp)
    file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
    embed.set_thumbnail(url="attachment://logo.png") 

    title = data_dict.get(index, {}).get('Title', 'Title not found')
    section = data_dict.get(index, {}).get('Section', 'Section not found')

    #Validate the index entered, by cross checking that it exists in the data_dict that stores all possible course sections for the semester.
    if index not in data_dict:
        embed.title = f"Invalid index. Please enter a valid index and try."
        await interaction.response.send_message(embed=embed, file=file, ephemeral=True)
        return
    
    #Once validated, check if user is stored in the database already or not and proceed accordingly.
    if user_id in user_data:
        if index in user_data[user_id]['sniped_classes']:
            #Remove the index from the specifed user's snipe list
            user_data[user_id]['sniped_classes'].remove(index)
            embed.title = f"{title} {section} at INDEX {index} is now removed!"
            await interaction.response.send_message(embed=embed, file=file,  ephemeral=True)
            print(f'Recieved /remove from {interaction.user} for {title} SECTION {section} at INDEX {index}')
            #Send and store log
            log = generate_new_log(timestamp=get_est_timestamp(), log_info=f"Received /remove request by {interaction.user} for {title} at SECTION {section} on INDEX {index}", status_code=200)
            dump_to_log_file(new_data=log)
        #If index is not found by key lookup in the data_dict, that means it is not valid and therefore notify user that it is not valid.
        else:
            embed.title = f"{index} not found in snipe list."
            await interaction.response.send_message(embed=embed, file=file, ephemeral=True)
    #If user exists in database but their snipe list is empty, notify user of scenario.
    else:
        embed.title = f"You are currently not sniping any classes."
        await interaction.response.send_message(embed=embed, file=file, ephemeral=True)
    #Update database with changes
    saving_user_data(user_data)




@bot.tree.command(name='clear', description='clears all snipes')
async def clear(interaction: Interaction):
    '''
    This async function executes when a user wants to clear all indexes in their snipe list that is stored in the database.
    '''

    #Get the Discord ID of user that ran this command
    user_id = str(interaction.user.id)
    embed = discord.Embed() 

    #Check if user currently has a snipe list active in database. If user exists, then proceed.
    if user_id in user_data:
        
        #We are just clearing the user's sniped_classes list but not removing the user id from the database itself.
        currently_sniping = user_data[user_id]['sniped_classes']
        currently_sniping.clear()
        print(f"Recieved /clear command from {interaction.user}")
        embed.title = f"All snipes are removed!"
        embed.color = discord.Color.green()
        avatar_url = interaction.user.avatar.url if interaction.user.avatar else interaction.user.default_avatar.url
        embed.set_author(name=interaction.user.display_name, icon_url=avatar_url)
        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        embed.set_thumbnail(url="attachment://logo.png") 
        
        

        timestamp = get_est_timestamp()
        embed.set_footer(text=timestamp)

            
        
        await interaction.response.send_message(embed=embed, file=file,  ephemeral=True)
        log = generate_new_log(timestamp=get_est_timestamp(), log_info=f"Recieved /clear by {interaction.user}", status_code=200)
        dump_to_log_file(new_data=log)
    else:
        
        await interaction.response.send_message("You are currently not sniping any classes.",  ephemeral=True)

    saving_user_data(user_data)


@bot.tree.command(name='check', description='check all current snipes')
async def check(interaction: Interaction):
    '''
    This async function is executed when a user wants to see a full detailed list of all of their current snipe list.
    '''

    #We get the most recent populated last_opened_dict which will be used for providing last opened dates if applicable to all indexes in the user's snipe list. 
    last_opened_dict = generate_updated_last_opened_date_dict()

    #Get the users Discord ID when they call the command
    user_id = str(interaction.user.id)
    embed = discord.Embed()

    #Check to see if the user id matches in the current database of users stored. If there is a match then proceed.
    if user_id in user_data:
        #Get this uers full snipe list
        sniped_classes = user_data[user_id]['sniped_classes']
        print(f'Recieved /check command from {interaction.user}')
        embed.title = f"All current sniped classes!"
        embed.color = discord.Color.green()
        avatar_url = interaction.user.avatar.url if interaction.user.avatar else interaction.user.default_avatar.url
        embed.set_author(name=interaction.user.display_name, icon_url=avatar_url)
        file = discord.File("RU_snipeZ_logo.png", filename='logo.png')
        embed.set_thumbnail(url="attachment://logo.png")  
        timestamp = get_est_timestamp()
        embed.set_footer(text=timestamp)

        #Populate a embed and put each index's corresponding course name, section, and last opened date if found.
        if sniped_classes:
            description = ''
            list_of_sniped_classes = list(sniped_classes)
            for item in list_of_sniped_classes:
                index = item
                title = data_dict.get(index, {}).get('Title', '--')
                section = data_dict.get(index, {}).get('Section', '--')
                description += f'`{index}`-{title} **Sec. {section}** \n {index} was Last Open: {last_opened_dict.get(index, "Unknown")}\n'
            embed.description = description
        else:
            embed.description = 'You are currently not sniping any classes.'

       
        await interaction.response.send_message(embed=embed, file=file,  ephemeral=True)
        #Store a log when command is ran by user.
        log = generate_new_log(timestamp=get_est_timestamp(), log_info=f"Recieved /check by {interaction.user}", status_code=200)
        dump_to_log_file(new_data=log)
    else:
        
        await interaction.response.send_message("You are currently not sniping any classes.",  ephemeral=True)
    #Save the users data.
    saving_user_data(user_data)


@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    await bot.process_commands(message) 

    user_id = str(message.author.id)
    if user_id not in user_data:
        user_data[user_id] = {
            'sniped_classes' : set(),
        }

    if message.content.startswith('hello'):
        await message.channel.send('Hello!')



#Discord Auth Portal Token For Running The Bot
bot.run('INSERT TOKEN HERE')