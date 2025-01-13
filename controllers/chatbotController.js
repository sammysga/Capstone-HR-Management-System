const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const expressFileUpload = require('express-fileupload');

const { getJobDetails } = require('./applicantController');
const fs = require('fs');
const path = require('path');

const chatbotController = {

    // Function to render chatbot page with the initial greeting
    getChatbotPage: async function(req, res) {
        try {
            const initialMessage = "Hi! Welcome to Prime Infrastructure's recruitment portal. What position are you going to apply for?";
            const positions = await chatbotController.getJobPositionsList();
            console.log('Positions fetched:', positions); // log to see what positions are returned

            const initialResponse = JSON.stringify(`${initialMessage}\nHere are our current job openings:\n${positions.map(pos => `- ${pos}`).join('\n')}\nPlease select a position.`);
            console.log('Initial response:', initialResponse);

            res.render('applicant_pages/chatbot', { initialResponse, errors: {} });
        } catch (error) {
            console.error('Error rendering chatbot page:', error);
            res.status(500).send('Error loading chatbot page');
        }
    },
    
    handleChatbotMessage: async function (req, res) {
        try {
            console.log('Start processing chatbot message'); // Log the start of the function
    
            const userId = req.session.user?.userId;
            const userMessage = req.body.message.toLowerCase();
            const timestamp = new Date().toISOString(); // Current timestamp
            console.log(`User ID: ${userId}, Message: ${userMessage}, Timestamp: ${timestamp}`);
    
            let botResponse;
            let applicantStage = req.session.applicantStage || 'initial'; 
            console.log(`Initial Applicant Stage: ${applicantStage}`);
    
            const positions = await chatbotController.getJobPositionsList();
            console.log('Retrieved Positions:', positions);
    
            const selectedPosition = positions.find(position => userMessage.includes(position.toLowerCase()));
           
    
            if (selectedPosition) {
                req.session.selectedPosition = selectedPosition;
                console.log('Selected Position:', selectedPosition);
                const jobDetails = await chatbotController.getJobDetails(selectedPosition);
                console.log('Job Details:', jobDetails);
    
                if (jobDetails) {
                    // Process certifications
                    const certifications = jobDetails.jobreqcertifications
                        ? jobDetails.jobreqcertifications
                            .map(cert => `${cert.jobReqCertificateType}: ${cert.jobReqCertificateDescrpt}`)
                            .join(', ')
                        : 'None';
    
                    // Process degrees
                    const degrees = jobDetails.jobreqdegrees
                        ? jobDetails.jobreqdegrees
                            .map(degree => `${degree.jobReqDegreeType}: ${degree.jobReqDegreeDescrpt}`)
                            .join(', ')
                        : 'None';
    
                    // Process experiences
                    const experiences = jobDetails.jobreqexperiences
                        ? jobDetails.jobreqexperiences
                            .map(exp => `${exp.jobReqExperienceType}: ${exp.jobReqExperienceDescrpt}`)
                            .join(', ')
                        : 'None';
    
                    // Process hard skills
                    const hardSkills = jobDetails.jobreqskills
                        ? jobDetails.jobreqskills
                            .filter(skill => skill.jobReqSkillType === 'Hard')
                            .map(skill => skill.jobReqSkillName)
                            .join(', ')
                        : 'None';
    
                    // Process soft skills
                    const softSkills = jobDetails.jobreqskills
                        ? jobDetails.jobreqskills
                            .filter(skill => skill.jobReqSkillType === 'Soft')
                            .map(skill => skill.jobReqSkillName)
                            .join(', ')
                        : 'None';
    
                    // Construct the bot response
                    botResponse = `You have chosen *${selectedPosition}*. Here are the details of the chosen job:\n` +
                        `Job Title: ${jobDetails.jobTitle}\n` +
                        `Job Description: ${jobDetails.jobDescrpt}\n` +
                        `The Job Requires the following certifications:\n${certifications}\n` +
                        `The Job Requires the following degrees:\n${degrees}\n` +
                        `The Job Requires the following experiences:\n${experiences}\n` +
                        `The Job Requires the following hard skills:\n${hardSkills}\n` +
                        `The Job Requires the following soft skills:\n${softSkills}\n` +
                        `Would you like to proceed with your application?\n- Yes\n- No`;
    
                    req.session.applicantStage = 'job_selection'; // Update applicantStage here
                } else {
                    botResponse = "Sorry, I couldn't find the job details.";
                }
            } 
            // Handling "Yes" response for application
            else if (userMessage.includes('yes')) {
                const jobId = (await chatbotController.getJobDetails(req.session.selectedPosition)).jobId;
                const questions = await chatbotController.getInitialScreeningQuestions(jobId);
                console.log('Initial Screening Questions:', questions);
    
                req.session.screeningQuestions = questions;
                req.session.currentQuestionIndex = 0;
                req.session.answers = []; // Initialize answers array
    
                if (questions.length) {
                    botResponse = `Great! Let's start. \n${questions[0].question}`;
                    req.session.applicantStage = 'screening_questions'; // Update applicantStage here
                } else {
                    botResponse = "No screening questions available for this position.";
                }
            } 
            // Handling "No" response for application
            else if (userMessage.includes('no')) {
                botResponse = 'No problem! Here are our current job openings:\n' + positions.map(pos => `- ${pos}`).join('\n') + '\nPlease select a position.';
                req.session.applicantStage = 'job_selection'; // Update applicantStage here
            }
    
            // Handling screening questions
            else if (req.session.screeningQuestions) {
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;
    
                console.log('Current Question Index:', currentIndex);
    
                // Store the answer based on "Yes" or "No"
                const answer = userMessage.includes('yes') ? 1 : (userMessage.includes('no') ? 0 : null);
    
                if (answer !== null) {
                    req.session.answers.push(answer); // Store the answer as 1 (Yes) or 0 (No)
                
                    // If there are more questions, ask the next one with buttons
                    if (currentIndex + 1 < questions.length) {
                        const nextQuestion = questions[currentIndex + 1];
                        const { text, buttons } = chatbotController.handleScreeningQuestions(nextQuestion);
                        
                        // Send the next question with buttons
                        botResponse = {
                            text: text, // Question text
                            buttons: buttons // Yes/No buttons
                        };
                
                        req.session.currentQuestionIndex++; // Move to the next question
                    } else {
                        // Process the answers and calculate the result
                        const { weightedScores, result } = await chatbotController.calculateWeightedScores(req.session.answers, req.session.selectedPosition, questions);
                        console.log("Scores:", weightedScores);
                
                        if (result === 'pass') {
                            botResponse = {
                                text: "Congratulations! You passed the screening.",
                                buttons: [] // No buttons needed here, final response
                            };
                        } else {
                            botResponse = {
                                text: "Sorry, you didn’t meet the required score.",
                                buttons: [] // No buttons needed here, final response
                            };
                        }
                
                        req.session.applicantStage = 'application_complete'; // Update applicantStage here
                    }
                } else {
                    botResponse = {
                        text: 'Please answer with "Yes" or "No".',
                        buttons: [] // No buttons needed here, prompt for proper answer
                    };
                }
                
            }
    
            res.status(200).json({ response: botResponse });
        } catch (error) {
            console.error('Error processing chatbot message:', error);
            res.status(500).json({ response: 'Sorry, I am having trouble understanding that.' });
        }
    },
    
// Function to fetch and structure all screening questions
getInitialScreeningQuestions: async function (jobId) {
    try {
        // Fetch job-related data
        const jobDetailsQueries = await Promise.all([
            supabase.from('jobreqdegrees').select('*').eq('jobId', jobId),
            supabase.from('jobreqexperiences').select('*').eq('jobId', jobId),
            supabase.from('jobreqcertifications').select('*').eq('jobId', jobId),
            supabase.from('jobreqskills').select('*').eq('jobId', jobId),
        ]);

        // Check for errors
        const errors = jobDetailsQueries.filter(result => result.error);
        if (errors.length > 0) {
            console.error("Error fetching job details:", errors);
            return [];
        }

        // Extract data
        const [
            degreesQuery,
            experiencesQuery,
            certificationsQuery,
            skillsQuery
        ] = jobDetailsQueries.map(result => result.data);

        // Map questions
        const questions = [
            ...degreesQuery.map(d => ({
                type: 'degree',
                text: `Do you have a degree related to ${d.jobReqDegreeType}: ${d.jobReqDegreeDescrpt}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...experiencesQuery.map(e => ({
                type: 'experience',
                text: `Do you have ${e.jobReqExperienceType}: ${e.jobReqExperienceDescrpt}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...certificationsQuery.map(c => ({
                type: 'certification',
                text: `Have you earned ${c.jobReqCertificateType}: ${c.jobReqCertificateDescrpt}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
            ...skillsQuery.map(s => ({
                type: s.jobReqSkillType.toLowerCase(),
                text: `To assess your ${s.jobReqSkillType.toLowerCase()} skills, do you have ${s.jobReqSkillName}?`,
                buttons: [
                    { text: 'Yes', value: 1 },
                    { text: 'No', value: 0 }
                ]
            })),
        ];

        return questions;
    } catch (error) {
        console.error("Error fetching screening questions:", error);
        return [];
    }
},


// Function to process screening questions and include Yes/No buttons
handleScreeningQuestions: function (questionObj) {
    const questionText = questionObj.question;
    const buttons = questionObj.options.map(option => {
        return { type: 'postback', title: option, payload: option }; // For interactive buttons
    });

    return {
        text: `${questionText}\nPlease select one of the following options:`,
        buttons: buttons
    };
},

    // Function to fetch job positions and format them for chatbot response
    getJobPositionsList: async function() {
        try {
            const { data: jobpositions, error } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle');
    
            if (error) {
                console.error('Error fetching job positions:', error);
                return []; // Return an empty array on error
            }
    
            return jobpositions.map(position => position.jobTitle);
        } catch (error) {
            console.error('Server error:', error);
            return [];
        }
    },

    // Function to fetch job details from the db
// Function to fetch detailed job information, including required certifications, degrees, experiences, and skills
getJobDetails: async function(jobTitle) {
    try {
        const { data: jobDetails, error } = await supabase
            .from('jobpositions')
            .select(`
                jobId, jobTitle, jobDescrpt,
                jobreqcertifications(jobReqCertificateType, jobReqCertificateDescrpt),
                jobreqdegrees(jobReqDegreeType, jobReqDegreeDescrpt),
                jobreqexperiences(jobReqExperienceType, jobReqExperienceDescrpt),
                jobreqskills(jobReqSkillType, jobReqSkillName)
            `)
            .eq('jobTitle', jobTitle)
            .single();

        if (error) {
            console.error('Error fetching job details:', error);
            return null;
        }

        return jobDetails;
    } catch (error) {
        console.error('Server error:', error);
        return null;
    }
},

    // Calculate weighted scores based on answers
    calculateWeightedScores: async function (answers, selectedPosition, questions) {
        try {
            const scores = {
                degreeScore: 0,
                experienceScore: 0,
                certificationScore: 0,
                hardSkillsScore: 0,
                softSkillsScore: 0,
                totalScore: 0
            };
    
            for (let i = 0; i < answers.length; i++) {
                const question = questions[i].toLowerCase();
                if (question.includes('degree')) scores.degreeScore += answers[i];
                else if (question.includes('experience')) scores.experienceScore += answers[i];
                else if (question.includes('certifications')) scores.certificationScore += answers[i];
                else if (question.includes('hard skills')) scores.hardSkillsScore += answers[i];
                else if (question.includes('soft skills')) scores.softSkillsScore += answers[i];
            }
    
            const totalScore = scores.degreeScore + scores.experienceScore +
                scores.certificationScore + scores.hardSkillsScore + scores.softSkillsScore;
            scores.totalScore = totalScore;
    
            const result = totalScore >= 15 ? 'pass' : 'fail';
    
            return { weightedScores: scores, result };
        } catch (error) {
            console.error("Error calculating scores:", error);
            return { weightedScores: {}, result: 'fail' };
        }
    },
    

    // Function to calculate weighted scores for screening answers
    // calculateWeightedScores: async function(answers, selectedPosition, screeningQuestions) {
    //     if (!screeningQuestions || screeningQuestions.length === 0) {
    //         return { weightedScores: [], result: 'fail' };
    //     }
    
    //     const jobDetails = await chatbotController.getJobDetails(selectedPosition);
    
    //     const weightings = {
    //         degreeRelevance: 1.5,  // Degree-related questions are weighted higher
    //         softSkills: 1,         // Soft skills-related questions have a standard weight
    //     };
    
    //     let totalScore = 0;
    //     const weightedScores = answers.map((answer, index) => {
    //         const question = screeningQuestions[index];
    //         let weight = 1; // Default weight
    
    //         if (question.toLowerCase().includes('degree required')) {
    //             weight = weightings.degreeRelevance;  
    //         } else if (question.toLowerCase().includes('experience') || question.toLowerCase().includes('skill')) {
    //             weight = weightings.softSkills;  
    //         }
    
    //         const weightedScore = answer * weight;
    //         totalScore += weightedScore;
    
    //         return weightedScore;
    //     });
    
    //     // Calculate average score and determine pass/fail
    //     const averageScore = totalScore / screeningQuestions.length;
    //     const result = averageScore >= 3 ? 'pass' : 'fail';  // Assume a threshold of 3 to pass
    
    //     return { weightedScores, result };
    // },    

    
// File upload handler in your controller
handleFileUpload: async function(req, res) {
    try {
        // Check if file is uploaded
        if (!req.files || !req.files.file) {
            return res.status(400).send('No file uploaded.');
        }

        const file = req.files.file;
        
        // Check if user is authenticated, if not, use 'anonymous'
        const userId = req.body.userId || 'anonymous'; // If userId is not provided, mark as 'anonymous'

        // Define the local file path
        const filePath = path.join(__dirname, '../uploads', file.name); // Use the uploads folder path

        // Ensure the uploads folder exists
        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        // Save the file to the server locally
        await file.mv(filePath);

        // Upload file to Supabase Storage
        const { data, error } = await supabase.storage
            .from('uploads') // Your Supabase bucket name
            .upload(file.name, file.data, {
                cacheControl: '3600',  // Cache control header
                upsert: false,         // Prevent overwriting files with the same name
            });

        if (error) {
            console.error('Error uploading file to Supabase:', error);
            return res.status(500).send('Error uploading file to Supabase.');
        }

        // Generate the public URL for the uploaded file
        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${data.Key}`; // Replace with your actual Supabase URL
        
        // Insert file metadata into the database (optional)
        const { data: insertedFile, error: insertError } = await supabase
            .from('user_files') // Your table for storing file metadata
            .insert([{
                userId: userId,     // User who uploaded the file (anonymous or authenticated)
                file_name: file.name, // File name
                file_url: fileUrl,    // Public URL of the uploaded file
                uploaded_at: new Date(),
                file_size: file.size  // File size in bytes
            }]);

        if (insertError) {
            console.error('Error inserting file metadata:', insertError);
            return res.status(500).send('Error inserting file metadata into database.');
        }

        // Return a success message with the file URL
        res.send(fileUrl); // Send back the file URL instead of just a success message

    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).send('Error uploading file.');
    }
}



};

module.exports = chatbotController;
