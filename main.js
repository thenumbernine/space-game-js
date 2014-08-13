var glutil;
var gl;

function rand(min, max) {
	return Math.random() * (max - min) + min
}

$(document).ready(function() {
	glutil = new GLUtil({fullscreen:true});
	gl = glutil.context;
	
	gl.disable(gl.DITHER);
	gl.enable(gl.CULL_FACE);
	gl.enable(gl.DEPTH_TEST);

	glutil.onfps = function(fps) {
		console.log('fps',fps);
	};

	/*var*/ quad = new glutil.SceneObject({
		mode : gl.TRIANGLES,
		shader : new glutil.ShaderProgram({
			vertexPrecision : 'best',
			vertexCode : mlstr(function(){/*
uniform mat4 projMat;
uniform mat4 mvMat;
attribute vec3 vertex;
uniform float scale;
void main() {
	gl_Position = projMat * mvMat * vec4(vertex * scale, 1.);
}
*/}),
			fragmentPrecision : 'best',
			fragmentCode : mlstr(function(){/*
uniform vec4 color;
void main() {
	gl_FragColor = color;
}
*/})
		}),
		attrs : {
			vertex : new glutil.ArrayBuffer({
				dim : 2,
				data : [-.5,-.5, .5,-.5, .5,.5, .5,.5, -.5,.5, -.5,-.5]
			})
		},
		static : false,
		parent : null
	});

	//game
	var Player;
	var Game = makeClass({
		init : function() {
			this.reset();
		},
		//call after init and assignment of 'game' global
		start : function() {
			this.player = new Player({
				pos : vec3.fromValues(0,0,-5)
			});
		},
		reset : function() {
			this.objs = [];
			this.time = 0;
			this.nextEnemyTime = 3;
		},
		update : function(dt) {
			//update
			for (var i = 0; i < this.objs.length; ++i) {
				this.objs[i].update(dt);
			}
			for (var i = this.objs.length-1; i >= 0; --i) {
				if (this.objs[i].remove) {
					this.objs.splice(i, 1);
				}
			}
				
			//game logic: add extra enemies
			if (this.time >= this.nextEnemyTime) {
				this.nextEnemyTime = this.time + 1;
				var theta = Math.random() * Math.PI * 2;
				var vel = vec3.fromValues(Math.cos(theta), Math.sin(theta), 1);
				var groupCenter = vec3.fromValues(
					rand(worldBounds.min[0] - 1, worldBounds.max[0] + 1),
					rand(worldBounds.min[1] - 1, worldBounds.max[1] + 1),
					worldBounds.min[2] + 1);
				var spread = 1.5;
				var waveSize = Math.floor(rand(2,6));
				var group = [];
				for (var i = 0; i < waveSize; ++i) {
					var groupAngle = i / waveSize * Math.PI * 2;
					var enemy = new Enemy({
						group : group,
						pos : vec3.fromValues(
							groupCenter[0] + spread * Math.cos(groupAngle),
							groupCenter[1] + spread * Math.sin(groupAngle),
							groupCenter[2]),
						vel : vel
					});
					group.push(enemy);
				}
			}

			this.time += dt;
		},
		draw : function() {
			glutil.draw();
			for (var i = 0; i < this.objs.length; ++i) {
				this.objs[i].draw();
			}
		}
	});
	
	/*var*/ worldBounds = {
		min : vec3.fromValues(-20, -20, -50),
		max : vec3.fromValues(20, 20, -5)
	};

	var GameObject = makeClass({
		color : vec4.fromValues(1,1,1,1),
		scale : 1,
		init : function(args) {
			this.pos = vec3.create();
			this.vel = vec3.create();
			if (args !== undefined) {
				if (args.pos !== undefined) vec3.copy(this.pos, args.pos);
				if (args.vel !== undefined) vec3.copy(this.vel, args.vel);
			}
			game.objs.push(this);
		},
		update : function(dt) {
			//trace movement
			var delta = vec3.create();
			vec3.scale(delta, this.vel, dt);
	
			var dest = vec3.create();
			vec3.add(dest, this.pos, delta);

			if (this.touch) {
				for (var i = 0; i < game.objs.length; ++i) {
					var o = game.objs[i];
					if (o.remove) continue;
					if (o == this) continue;
					
					//for now assume we're quads ...
					var f = (o.pos[2] - this.pos[2]) / delta[2];
					if (f < 0 || f > 1) continue;

					var x = this.pos[0] + f * delta[0];
					var y = this.pos[1] + f * delta[1];
					var dx = x - o.pos[0];
					var dy = y - o.pos[1];
					if (Math.abs(dx) < (this.scale + o.scale) * .5 &&
						Math.abs(dy) < (this.scale + o.scale) * .5)
					{
						//TODO proper physics?  store all objects we will touch and process in order? 
						this.touch(o);
					}
					if (this.remove) return;
				}
			}

			vec3.copy(this.pos, dest);
			
			if (this.removeWhenOOB) {
				if (this.pos[0] < worldBounds.min[0] || this.pos[0] > worldBounds.max[0] ||
					this.pos[1] < worldBounds.min[1] || this.pos[1] > worldBounds.max[1] ||
					this.pos[2] < worldBounds.min[2] || this.pos[2] > worldBounds.max[2])
				{
					this.remove = true;
					return;
				}
			} else {
				if (this.pos[0] < worldBounds.min[0]) this.pos[0] = worldBounds.min[0];
				if (this.pos[0] > worldBounds.max[0]) this.pos[0] = worldBounds.max[0];
				if (this.pos[1] < worldBounds.min[1]) this.pos[1] = worldBounds.min[1];
				if (this.pos[1] > worldBounds.max[1]) this.pos[1] = worldBounds.max[1];
				if (this.pos[2] < worldBounds.min[2]) this.pos[2] = worldBounds.min[2];
				if (this.pos[2] > worldBounds.max[2]) this.pos[2] = worldBounds.max[2];
			}
		},
		draw : function() {
			vec3.copy(quad.pos, this.pos);
			quad.draw({
				uniforms : {
					color : this.color,
					scale : this.scale
				}
			});
		}
	});
	
	var Shot = makeClass({
		super : GameObject,
		speed : 4,
		color : vec4.fromValues(1,1,0,.5),
		scale : .3,
		damage : 1,
		removeWhenOOB : true,
		init : function(args) {
			Shot.super.apply(this, arguments);
			//this.life = 20;
			if (args !== undefined) {
				if (args.owner !== undefined) {
					this.owner = args.owner;
					vec3.copy(this.pos, args.owner.pos);
				}
				if (args.speed !== undefined) this.speed = args.speed;
				if (args.dir !== undefined) {
					vec3.scale(this.vel, args.dir, this.speed);
				}
			}
		},
		update : function(dt) {
			Shot.superProto.update.apply(this, arguments);
			/*this.life = this.life - dt;
			if (this.life <= 0) {
				this.remove = true;
				return;
			}*/
		},
		touch : function(other) {
			if (other == this.owner) return;
			if (!other.takeDamage) return;
			other.takeDamage(this.damage, this, this.owner);
		}
	});

	var Shrapnel = makeClass({
		super : GameObject,
		scale : .1,
		init : function(args) {
			Shrapnel.super.apply(this, arguments);
			this.vel[0] = rand(-5, 5);
			this.vel[1] = rand(-5, 5);
			this.vel[2] = rand(-5, 5);
			this.life = rand(.5, 1.5);
			this.scale = rand(.05, .15);
		},
		update : function(dt) {
			Shrapnel.superProto.update.apply(this, arguments);
			this.life -= dt;
			if (this.life < 0) this.remove = true;
		}
	});

	var Ship = makeClass({
		super : GameObject,
		removeWhenOOB : true,
		maxHealth : 1,
		reloadTime : 1,
		init : function(args) {
			Ship.super.apply(this, arguments);
			this.nextShotTime = 0;
			this.health = this.maxHealth;
			if (args !== undefined) {
				if (args.health !== undefined) this.health = args.health;
			}
		},
		shoot : function(dx,dy,dz) {
			if (game.time < this.nextShotTime) return;
			this.nextShotTime = game.time + this.reloadTime;	//reload time
			new Shot({
				owner : this,
				speed : this.shotSpeed,
				dir : vec3.fromValues(dx, dy, dz)
			});
		},
		takeDamage : function(damage, inflicter, attacker) {
			this.health -= damage;
			
			for (var i = 0; i < 20; ++i) {
				new Shrapnel({
					pos : this.pos
				});
			}
			
			if (this.health <= 0) this.die(inflicter, attacker);
		},
		die : function(inflicter, attacker) {
			this.remove = true;
		}
	});

	var Enemy = makeClass({
		super : Ship,
		color : vec4.fromValues(0,1,0,1),
		init : function(args) {
			Enemy.super.apply(this, arguments);
			if (args !== undefined) {
				if (args.group !== undefined) this.group = args.group;
			}
		},
		update : function(dt) {
			Enemy.superProto.update.apply(this, arguments);
			this.shoot(0,0,1);		
			if (this.group !== undefined) {
				// do some cool BOIDs routine
				var center = vec3.create();
				for (var i = 0; i < this.group.length; ++i) {
					vec3.add(center, center, this.group[i].pos);
				}
				vec3.scale(center, center, 1/this.group.length);
				//now ... spin around it!
				var delta = vec3.create();
				vec3.sub(center, this.pos, delta);
				vec3.scaleAndAdd(this.vel, this.vel, delta, .01);
			}
		}
	});
	
	var Player = makeClass({
		super : Ship,
		color : vec4.fromValues(1,0,0,1),
		maxHealth : 20,
		shotSpeed : 20,
		reloadTime : .2,
		init : function() {
			Player.super.apply(this, arguments);
			this.targetPos = vec3.create();
			this.aimPos = vec3.create();
			this.aimPos[2] = worldBounds.min[2];
			this.speed = 10;
		},
		update : function(dt) {
			//determine velocity
			this.vel[0] *= .5;
			this.vel[1] *= .5;
			this.vel[2] *= .5;
			var deltaX = this.targetPos[0] - this.pos[0];
			var deltaY = this.targetPos[1] - this.pos[1];
			var deltaZ = this.targetPos[2] - this.pos[2];
			var deltaLenSq = deltaX*deltaX + deltaY*deltaY + deltaZ*deltaZ;
			if (deltaLenSq > .01*.01) {
				var movement = this.speed * dt;
				if (deltaLenSq < movement * movement) {
					vec2.copy(this.pos, this.targetPos);
				} else {
					var deltaLen = Math.sqrt(deltaLenSq);
					var s = this.speed/deltaLen;	//don't factor in dt ... that'll be done by integration
					deltaX *= s;
					deltaY *= s;
					deltaZ *= s;
					this.vel[0] = deltaX;
					this.vel[1] = deltaY;
					//this.pos[2] += deltaZ;
				}
			}
			
			//integrate
			Player.superProto.update.apply(this, arguments);

			if (this.shooting) {
				var dir = vec3.create();
				vec3.sub(dir, this.aimPos, this.pos);
				vec3.normalize(dir, dir);
				this.shoot(dir[0], dir[1], dir[2]);
			}
		},
		takeDamage : function(damage, inflicter, attacker) {
			Player.superProto.takeDamage.apply(this, arguments);
			console.log('hit and at',this.health);
		},
		die : function(inflicter, attacker) {
			Player.superProto.die.apply(this, arguments);
			game.player = undefined;
			//restart the game
			setTimeout(function() {
				//I was just creating a new game, but Chrome leaked badly and the framerate of the subsequent games got kicked down a big percent each time. 
				game.reset();
				game.start();
			}, 5000);
		}
	});
	
	/*var*/ game = new Game();
	game.start();
	
	//update loop
	var update = function() {
		var dt = 1/30;
		game.update(dt);
		game.draw();
		requestAnimFrame(update);
	};
	update();

	//mouse input
	var movePlayer = function(xf, yf) {
		if (game.player === undefined) return;
		var aspectRatio = glutil.canvas.width / glutil.canvas.height;
		var playerZPlane = glutil.view.pos[2] - game.player.pos[2];
		game.player.targetPos[0] = (xf * 2 - 1) * aspectRatio * playerZPlane;
		game.player.targetPos[1] = (1 - yf * 2) * playerZPlane;
		game.player.aimPos[0] = game.player.targetPos[0];
		game.player.aimPos[1] = game.player.targetPos[0];
	};
	var aimPlayer = function(xf, yf) {
		if (game.player === undefined) return;
		var aspectRatio = glutil.canvas.width / glutil.canvas.height;
		var playerZPlane = glutil.view.pos[2] - game.player.pos[2];
		game.player.aimPos[0] = (xf * 2 - 1) * aspectRatio * playerZPlane;
		game.player.aimPos[1] = (1 - yf * 2) * playerZPlane;
		//exhaggerate
		var exhaggeration = 2;
		game.player.aimPos[0] += (game.player.aimPos[0] - game.player.targetPos[0]) * exhaggeration + game.player.targetPos[0];
		game.player.aimPos[1] += (game.player.aimPos[1] - game.player.targetPos[1]) * exhaggeration + game.player.targetPos[1];
	};
	var handleInputEvent = function(e) {
		var xf = e.pageX / window.innerWidth;
		var yf = e.pageY / window.innerHeight;
		if (e.shiftKey) {
			aimPlayer(xf, yf);
		} else {
			movePlayer(xf, yf);
		}
	};
	$(window).bind('mousemove', function(e) {
		handleInputEvent(e);
	});
	$(window).bind('mousedown', function(e) {
		game.player.shooting = true;
	});
	$(window).bind('mouseup', function(e) {
		game.player.shooting = false;
	});
	$(window).bind('touchmove', function(e) {
		handleInputEvent(e.originalEvent.changedTouches[0]);
	});
});

