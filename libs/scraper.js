const cron = require('node-cron');
const cheerio = require('cheerio');
const request = require('request');
const PostsModel = require('../app/models/posts');
const Logger = require('./logger.js');

class Scrapper {
    /**
     * Get Post Title
     * @param post
     * @return string
     */
    static getPostTitle (post) {
        const titleElement = post.find('h3').eq(0);

        return titleElement.text();
    }

    /**
     * Get Post URL
     * @param post
     * @return string
     */
    static getPostUrl (post) {
        const urlElement = post.find('h3').find('a');

        return urlElement.attr('href');
    }

    /**
     * Get Post Image
     * @param post
     * @return string
     */
    static getPostImg (post) {
        const imgElement = post.find('img');

        return imgElement.attr('src');
    }

    /**
     * Get Post Id
     *
     * To get Id trim href and get post id
     *
     * @param post
     * @return string
     */
    static getPostId (post) {
        const urlElement = post.find('h3').find('a');
        const url = urlElement.attr('href');
        const trimmed = /post\/(\d+)\//.exec(url);

        if (!trimmed) return '';
        return trimmed[1];
    }

    /**
     * Get Post Author
     *
     * If there is no author, return null
     *
     * @param post
     * @return string ? null
     */
    static getPostAuthor (post) {
        const authorElement = post.find('p').find('i').first();

        if (authorElement.length) {
            return authorElement.text();
        }

        return null;
    }

    /**
     * Create Post Model (Mongoose model)
     *
     * Collect post object data
     *
     * @param post - Set Cheerio element e.g. $('.post').first()
     * @returns {{id: string, title: string, url: string, img: string, author: string ? null}}
     */
    static createPostModel (post) {
        return {
            post_id: Scrapper.getPostId(post),
            title: Scrapper.getPostTitle(post),
            url: Scrapper.getPostUrl(post),
            img: Scrapper.getPostImg(post),
            author: Scrapper.getPostAuthor(post)
        };
    }

    constructor ({cronSchedule, baseURL}) {
        this.time = cronSchedule;
        this.html = {};

        this.errors = {
            notFoundPost: 'notFoundPost',
            exists: 'exists',
            fetchError: 'fetchError'
        };

        this.state = {
            page: 1,
            post: 0,
            error: {}
        };

        this.URL = `${baseURL}`;
    }

    /**
     * Handle Pagination for scraper
     *
     * If current site is equal 0, do not serve /page/1,
     * thecodinglove.com redirect to / and request module has problem to handle posts
     */
    pagination (page) {
        if (page === 1) {
            return this.URL;
        }

        return `${this.URL}/page/${page}`;
    }

    /**
     * Create Post in Database
     *
     * Check if Post with ${Model.post_id} exists,
     * if exists, return with error
     * if not exists, create new Post
     *
     * @param Model - Mongoose DB Model
     * @param callback
     *
     * Callback params:
     *
     * Error - error while fetching data
     * PostId - pass a post id
     */
    createDatabasePost (Model, callback) {
        return PostsModel.findOne({post_id: Model.post_id}, (error, post) => {
            if (error) return callback({
                stack: this.errors.fetchError,
                message: `Error while fetching database data: ${JSON.stringify(error)}, Message: ${error.message}`
            });

            if ('stack' in this.state.error && this.state.error.stack === this.errors.fetchError) {
                Logger({message: 'Found post, Cleaning error stack with fetchError error'});

                this.state.error = {};
            }

            if (post) return callback({
                stack: this.errors.exists,
                message: `In database there is post with id: ${post.post_id}, exiting`
            });

            if ('stack' in this.state.error && this.state.error.stack === this.errors.exists) {
                Logger({message: 'Found post, Cleaning error stack with exists error'});

                this.state.error = {};
            }

            PostsModel.create(Model, (error) => {
                if (error) return callback({
                    stack: this.errors.fetchError,
                    message: `Error while saving data to database: ${JSON.stringify(error)}, Message: ${error.message}`
                });

                if ('stack' in this.state.error && this.state.error.stack === this.errors.fetchError) {
                    Logger({message: 'Found post, Cleaning error stack with fetchError error'});

                    this.state.error = {};
                }

                callback(null, Model.post_id);
            });
        });
    }

    /**
     * Simplified HTTP request stack
     *
     * @param callback
     *
     * Callback params:
     *
     * Error - error while fetching data
     *
     * Method using Fetch module from npm, more options:
     * info: https://www.npmjs.com/package/request#requestoptions-callback
     *
     */
    fetchData (callback) {
        if (!Object.keys(this.html).length) {
            const url = this.pagination(this.state.page);

            return request(url, (error, response, html) => {
                if (error) return callback({
                    stack: this.errors.fetchError,
                    message: `Error while requesting a url ${url}, Error: ${JSON.stringify(error)}`
                });

                this.html = html;

                return callback(null);
            });
        }

        if ('stack' in this.state.error && this.state.error.stack === this.errors.fetchError) {
            Logger({message: 'Found post, Cleaning error stack with fetchError error'});

            this.state.error = {};
        }

        return callback(null);
    }

    /**
     * Fetching a post from data stack
     *
     * @param callback
     *
     * Callback params:
     *
     * Error - error while fetching data
     * PostId - pass a post id
     *
     */
    fetchPost (callback) {
        const $ = cheerio.load(this.html);
        const posts = $('.post');
        const current = posts.eq(this.state.post);

        if (!current.length) return callback({
            stack: this.errors.notFoundPost,
            message:`Error while fetching element, cannot find: $('.post').eq(${this.state.post})`
        });

        if ('stack' in this.state.error && this.state.error.stack === this.errors.notFoundPost) {
            Logger({message: 'Found post, Cleaning error stack with notFoundPost error'});

            this.state.error = {};
        }

        return callback(null, current);
    }

    runner () {
        Logger({message: `Fetching ${this.state.post} at page, ${this.state.page}. URL: ${this.pagination(this.state.page)}`});

        this.fetchData((error) => {
            if (error && error.stack === this.errors.fetchError) {
                if ('stack' in this.state.error && this.state.error.stack === this.errors.notFoundPost) {
                    Logger({message: 'There is problem with connection'});

                    this.state.error = {};

                    return false;
                }

                Object.assign(this.state.error, error);

                Logger({message: error.message});

                return this.runner();
            }

            this.fetchPost((error, currentElement) => {
                if (error && error.stack === this.errors.notFoundPost) {
                    if ('stack' in this.state.error && this.state.error.stack === this.errors.notFoundPost) {
                        Logger({message: 'There is no more post in, exiting interval'});

                        this.state.error = {};

                        return false;
                    }

                    Object.assign(this.state.error, error);

                    this.state.page = this.state.page + 1;
                    this.state.post = 0;
                    this.html = {};

                    Logger({message: error.message});

                    return this.runner();
                }

                const Model = new PostsModel(Scrapper.createPostModel(currentElement));

                this.createDatabasePost(Model, (error, postId) => {
                    if (error && error.stack === this.errors.exists) {
                        if ('stack' in this.state.error && this.state.error.stack === this.errors.exists) {
                            Logger({message: 'Your database is up-to-date, exiting'});

                            this.state.error = {};

                            return false;
                        }

                        Object.assign(this.state.error, error);

                        Logger({message: error.message});

                        return this.runner();
                    }

                    this.state.error = {};
                    Logger({message: `Scraped post with id: ${postId}`});

                    this.state.post = this.state.post + 1;

                    this.runner();
                });
            });
        });

    }

    /**
     * Method to handle Scraper,
     * For future purpose should only handle cron and method that you pass
     *
     * TODO: Refactor method for Single Responsibility
     */
    runCron () {
        if (!this.time) return Logger({message: 'Config time schedule for your cron'});

        /**
         * Crone schedule
         *
         * Start crone schedule in every ${this.time} - comes from main application file,
         * @param !string expression - Cron expression
         * @param !Function func - Task to be executed
         * @param boolean? immediateStart - Whether to start scheduler immediately after create - @optional
         */
        const task = cron.schedule(this.time, () => {
            Logger({message: `Running new cron in every ${this.time}`});

            this.runner();
        }, false);

        task.start();
    }
}

module.exports = Scrapper;
