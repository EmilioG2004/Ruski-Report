# Product Scope

## Purpose

This application is meant to be a way to view live scores from an active game that is being played. The game is unique to my school, but lots of people want to tune in and keep up with live scores, and this app provides an easy way to do so. The initial version will focus on viewing official tournament games, live score updates, box scores, and tournament progress. The pinnacle of this would be hosting the yearly tournament on the application, where 32 teams play a group stage and then a playoff bracket to determine a champion. There will be light social elements, like a comment section under matches similar to the Real sports app where people can leave comments regarding the game in real time. Ideally, we will be able to connect this to GameCenter to create an account system similar to Clash Royale with a TauID that mirrors some of the functionality of a SupercellID, really to just make it so players being added to the games are indeed tied to a real person.

## Goals

- Goal 1: Users will be able to create an account, or bypass accounts and use a guest view to just view scores. 
- Goal 2: Users will be able to view official tournament matches, live score sheets, box scores, and tournament standings.
- Goal 3: A "global" tournament will be posted every year that anyone can view and comment on, but will be managed by an administrator.

## Non-Goals

- Non-goal 1: This is not a social messaging app. There will be little social interaction outside of comment sections on games
- Non-goal 2: This is designed for our specific beer pong variation. APIs will be designed with extensibility in mind but idea is for app to host beer pong.
- Non-goal 3: Users will not be able to create their own match instances in the initial release. Game instantiation will be deferred until the app has an in-app scoring platform.

## Core User Flows

- Flow 1: User opens the app to a landing home page. Home Page shows a stylized, clickable box representing the tournament that takes the user to a tournament landing page.
- Flow 2: User clicks a box representing a game is brought to a live score sheet, with a box score and live updates visualized. The score sheet is like a game landing page.

## Initial Release Scope

- Feature 1: Tournament Viewing
- Feature 2: Account System

## Future Considerations

- Future idea 1: Create a design extensible enough so that in the future a game (interface) can be extended to include other games, such as dye.
- Future idea 2: Allow for tracking of player statistics and superlatives, meaning for a season hand out "awards" and "recognitions" for things like highest shooting percentage, lowest shooting percentage, fastest cup chug, etc. 
- Future idea 3: Integrate an LLM call to provide AI generated match summaries for games.
- Future idea 4: Create an in-app scoring platform to provide scorekeepers a way to keep score. Currently it is just reflecting an excel sheet. 
- Future idea 5: Allow users to create instances of their own game with a scoring platform so as to track shots.
