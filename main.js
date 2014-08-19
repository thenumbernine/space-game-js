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
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);	//TODO sort all sprites by z?

	var defaultShader = new glutil.ShaderProgram({
		vertexPrecision : 'best',
		vertexCode : mlstr(function(){/*
uniform mat4 projMat;
attribute vec3 vertex;
attribute vec4 color;
varying vec4 colorv;
void main() {
	colorv = color;
	gl_Position = projMat * vec4(vertex, 1.);
}
*/}),
		fragmentPrecision : 'best',
		fragmentCode : mlstr(function(){/*
varying vec4 colorv;
void main() {
	gl_FragColor = colorv;
}
*/})
	});

	var maxQuads = 10000;
	/*var*/ quadVertexBuffer = gl.createBuffer();
	/*var*/ quadVertexArray = new Float32Array(maxQuads * 6 * 7);
	gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, quadVertexArray, gl.DYNAMIC_DRAW);

	gl.useProgram(defaultShader.obj);
	gl.enableVertexAttribArray(defaultShader.attrs.vertex.loc);
	gl.enableVertexAttribArray(defaultShader.attrs.color.loc);
	gl.vertexAttribPointer(defaultShader.attrs.vertex.loc, 3, gl.FLOAT, false, 7 * 4, 0);
	gl.vertexAttribPointer(defaultShader.attrs.color.loc, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
	gl.useProgram(null);

	/*var*/ quadIndex = 0;
	var frames = 0;
	var lastTime = Date.now();
	var initDrawFrame = function() {
		{
			frames++;
			thisTime = Date.now();
			if (thisTime - lastTime > 1000) {
				var fps = frames * 1000 / (thisTime - lastTime);
				//console.log('fps', fps);
				frames = 0;
				lastTime = thisTime;	
			}
		}
	
		quadIndex = 0;
		glutil.scene.setupMatrices();
	};

	var finishDrawFrame = function() {
		gl.useProgram(defaultShader.obj);
		gl.uniformMatrix4fv(defaultShader.uniforms.projMat.loc, false, glutil.scene.projMat);
		
		//re-bind the vertex object
		gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
		gl.enableVertexAttribArray(defaultShader.attrs.vertex.loc);
		gl.enableVertexAttribArray(defaultShader.attrs.color.loc);
		gl.vertexAttribPointer(defaultShader.attrs.vertex.loc, 3, gl.FLOAT, false, 7 * 4, 0);
		gl.vertexAttribPointer(defaultShader.attrs.color.loc, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
		
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVertexArray);
		gl.drawArrays(gl.TRIANGLES, 0, quadIndex * 6);
	};

	//http://lab.concord.org/experiments/webgl-gpgpu/webgl.html
	var encodeShader = new glutil.ShaderProgram({
		vertexPrecision : 'best',
		vertexCode : mlstr(function(){/*
attribute vec2 vertex;
attribute vec2 texCoord;
varying vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
*/}),
		fragmentPrecision : 'best',
		fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform sampler2D tex;

float shift_right(float v, float amt) {
	v = floor(v) + 0.5;
	return floor(v / exp2(amt));
}

float shift_left(float v, float amt) {
	return floor(v * exp2(amt) + 0.5);
}

float mask_last(float v, float bits) {
	return mod(v, shift_left(1.0, bits));
}

float extract_bits(float num, float from, float to) {
	from = floor(from + 0.5);
	to = floor(to + 0.5);
	return mask_last(shift_right(num, from), to - from);
}

vec4 encode_float(float val) {
	if (val == 0.0)
		return vec4(0, 0, 0, 0);
	float sign = val > 0.0 ? 0.0 : 1.0;
	val = abs(val);
	float exponent = floor(log2(val));
	float biased_exponent = exponent + 127.0;
	float fraction = ((val / exp2(exponent)) - 1.0) * 8388608.0;
	
	float t = biased_exponent / 2.0;
	float last_bit_of_biased_exponent = fract(t) * 2.0;
	float remaining_bits_of_biased_exponent = floor(t);
	
	float byte4 = extract_bits(fraction, 0.0, 8.0) / 255.0;
	float byte3 = extract_bits(fraction, 8.0, 16.0) / 255.0;
	float byte2 = (last_bit_of_biased_exponent * 128.0 + extract_bits(fraction, 16.0, 23.0)) / 255.0;
	float byte1 = (sign * 128.0 + remaining_bits_of_biased_exponent) / 255.0;
	return vec4(byte4, byte3, byte2, byte1);
}

void main() {
	vec4 data = texture2D(tex, pos);
	gl_FragColor = encode_float(data[0]);
}
*/}),
		uniforms : {
			tex : 0
		}
	});

	var ShotSystem = makeClass({
		init : function() {
			this.texSize = 256;
			
			var initialDataF32 = new Float32Array(this.texSize * this.texSize * 4);
			for (var i = 0; i < this.texSize * this.texSize * 4; ++i) {
				initialDataF32[i] = Infinity;
			}

			var initialDataI8 = new Uint8Array(this.texSize * this.texSize * 4);
			for (var i = 0; i < this.texSize * this.texSize * 4; ++i) {
				initialDataI8[i] = 0;
			}
			
			this.posTex = new glutil.Texture2D({
				width : this.texSize,
				height : this.texSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.FLOAT,
				minFilter : gl.NEAREST,
				magFilter : gl.NEAREST,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : initialDataF32
			});
			this.velTex = new glutil.Texture2D({
				width : this.texSize,
				height : this.texSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.FLOAT,
				minFilter : gl.NEAREST,
				magFilter : gl.NEAREST,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : initialDataF32
			});
			this.accelTex = new glutil.Texture2D({
				width : this.texSize,
				height : this.texSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.FLOAT,
				minFilter : gl.NEAREST,
				magFilter : gl.NEAREST,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : initialDataF32
			});		
			this.float4ScratchTex = new glutil.Texture2D({
				width : this.texSize,
				height : this.texSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.FLOAT,
				minFilter : gl.NEAREST,
				magFilter : gl.NEAREST,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : initialDataF32
			});
		
			this.reduceTex = new glutil.Texture2D({
				width : this.texSize,
				height : this.texSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.FLOAT,
				minFilter : gl.NEAREST,
				magFilter : gl.NEAREST,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : initialDataF32
			});
			this.byte4ScratchTex = new glutil.Texture2D({
				width : this.texSize,
				height : this.texSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.UNSIGNED_BYTE,
				minFilter : gl.NEAREST,
				magFilter : gl.NEAREST,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : initialDataI8
			});
			this.fbo = new glutil.Framebuffer({
				width : this.texSize,
				height : this.texSize
			});

			var shotTexSize = 64;
			var shotTexData = new Uint8Array(shotTexSize * shotTexSize * 4);
			{
				var e = 0;
				for (var j = 0; j < shotTexSize; ++j) {
					var y = (j + .5) / shotTexSize; 
					var dy = 2 * (y - .5);
					for (var i = 0; i < shotTexSize; ++i) {
						var x = (i + .5) / shotTexSize; 
						var dx = 2 * (x - .5);
						var l = Math.sqrt(Math.max(0, 1 - dx*dx - dy*dy));
						shotTexData[e++] = 255;
						shotTexData[e++] = 255;
						shotTexData[e++] = 255;
						shotTexData[e++] = 255 * l;
					}
				}
			}
			this.shotTex = new glutil.Texture2D({
				width : shotTexSize,
				height : shotTexSize,
				internalFormat : gl.RGBA,
				format : gl.RGBA,
				type : gl.UNSIGNED_BYTE,
				minFilter : gl.NEAREST,
				magFilter : gl.LINEAR,
				wrap : {
					s : gl.REPEAT,
					t : gl.REPEAT
				},
				data : shotTexData
			});

			//in absense of PBOs or geom shader, this is what I'm stuck with
			//store a lookup for each tex coord here.  pass it through the shader.
			this.vertexBuffer = gl.createBuffer();
			this.vertexArray = new Float32Array(this.texSize * this.texSize * 2);
			for (var j = 0; j < this.texSize; ++j) {
				for (var i = 0; i < this.texSize; ++i) {
					this.vertexArray[0 + 2 * (i + this.texSize * j)] = (i + .5) / this.texSize;
					this.vertexArray[1 + 2 * (i + this.texSize * j)] = (j + .5) / this.texSize;
				}
			}
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, this.vertexArray, gl.STATIC_DRAW);

			//quad obj for kernel
			this.quadObj = new glutil.SceneObject({
				mode : gl.TRIANGLE_STRIP,
				attrs : {
					vertex : new glutil.ArrayBuffer({
						dim : 2,
						data : [-1,-1, 1,-1, -1,1, 1,1]
					}),
					texCoord : new glutil.ArrayBuffer({
						dim : 2,
						data : [0,0, 1,0, 0,1, 1,1]
					})
				},
				parent : null,
				static : true
			});

			this.updatePosShader = new glutil.ShaderProgram({
				vertexPrecision : 'best',
				vertexCode : mlstr(function(){/*
attribute vec2 vertex;
attribute vec2 texCoord;
varying vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
*/}),
				fragmentPrecision : 'best',
				fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform sampler2D posTex;
uniform sampler2D velTex;
uniform float dt;
uniform vec3 playerPos;
void main() {
	vec3 oldPos = texture2D(posTex, pos).xyz;
	vec4 shotVel = texture2D(velTex, pos);

	vec3 delta = shotVel.xyz * dt;
	vec3 newPos = oldPos + delta;
	
	float didCollide = 0.;
	float frac = (playerPos.z - oldPos.z) / delta.z;
	if (frac >= 0. && frac <= 1.) {
		vec2 intersect = oldPos.xy + frac * delta.xy;
		vec2 intersectOffset = intersect - playerPos.xy;

		const float playerSize = 1.;
		const float shotSize = .1;
		const float intersectCheckSize = .5 * (playerSize + shotSize);
		if (abs(intersectOffset.x) < intersectCheckSize &&
			abs(intersectOffset.y) < intersectCheckSize)
		{
			didCollide = shotVel.w;
		}
	}

	gl_FragColor = vec4(newPos, didCollide);
}
*/}),
				uniforms : {
					dt : 0,
					posTex : 0,
					velTex : 1
				},
			});
			
			//just like above except without the collision check
			//TODO separate collision check into its own shader and just use one IntegrateEuler shader?
			// then we wouldn't have to have a separate reduce shader for moving collision flag from 3rd to 0th channel
			//the tradeoff is it would be more tedious to do sweeping collisions 
			//-- intentionally keeping track of the last pos tex, or not touching the float4 scratch tex
			this.updateVelShader = new glutil.ShaderProgram({
				vertexPrecision : 'best',
				vertexCode : mlstr(function(){/*
attribute vec2 vertex;
attribute vec2 texCoord;
varying vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
*/}),
				fragmentPrecision : 'best',
				fragmentCode : mlstr(function(){/*
varying vec2 pos;
uniform sampler2D velTex;
uniform sampler2D accelTex;
uniform float dt;
void main() {
	//preserve w, the shot's damage
	//store it here because updatePos replaces the w of the pos for the collision flag
	//...though I could separate that in favor of my generic integration kernel 
	vec4 vel = texture2D(velTex, pos);
	vec3 accel = texture2D(accelTex, pos).xyz;

	vel.xyz += accel * dt;
	gl_FragColor = vel;
}
*/}),
				uniforms : {
					dt : 0,
					velTex : 0,
					accelTex : 1
				},
			});
	
			this.collisionReduceFirstShader = new glutil.ShaderProgram({
				vertexPrecision : 'best',
				vertexCode : mlstr(function(){/*
attribute vec2 vertex;
attribute vec2 texCoord;
varying vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
*/}),
				fragmentPrecision : 'best',
				fragmentCode : mlstr(function(){/*
uniform sampler2D srcTex;
uniform vec2 texsize;
uniform vec2 viewsize;
varying vec2 pos;
void main() {
	vec2 intPos = pos * viewsize - .5;
	
	float a = texture2D(srcTex, (intPos * 2. + .5) / texsize).a;
	float b = texture2D(srcTex, (intPos * 2. + vec2(1., 0.) + .5) / texsize).a;
	float c = texture2D(srcTex, (intPos * 2. + vec2(0., 1.) + .5) / texsize).a;
	float d = texture2D(srcTex, (intPos * 2. + vec2(1., 1.) + .5) / texsize).a;
	float e = a + b;
	float f = c + d;
	float g = e + f;
	gl_FragColor = vec4(g, 0., 0., 0.);
}
*/})
			});

			this.collisionReduceShader = new glutil.ShaderProgram({
				vertexPrecision : 'best',
				vertexCode : mlstr(function(){/*
attribute vec2 vertex;
attribute vec2 texCoord;
varying vec2 pos;
void main() {
	pos = texCoord;
	gl_Position = vec4(vertex, 0., 1.);
}
*/}),
				fragmentPrecision : 'best',
				fragmentCode : mlstr(function(){/*
uniform sampler2D srcTex;
uniform vec2 texsize;
uniform vec2 viewsize;
varying vec2 pos;
void main() {
	vec2 intPos = pos * viewsize - .5;
	
	float a = texture2D(srcTex, (intPos * 2. + .5) / texsize).x;
	float b = texture2D(srcTex, (intPos * 2. + vec2(1., 0.) + .5) / texsize).x;
	float c = texture2D(srcTex, (intPos * 2. + vec2(0., 1.) + .5) / texsize).x;
	float d = texture2D(srcTex, (intPos * 2. + vec2(1., 1.) + .5) / texsize).x;
	float e = max(a,b);
	float f = max(c,d);
	float g = max(e,f);
	gl_FragColor = vec4(g, 0., 0., 0.);
}
*/})
			});

			this.drawShader = new glutil.ShaderProgram({
				vertexPrecision : 'best',
				vertexCode : mlstr(function(){/*
attribute vec2 vertex;
uniform sampler2D posTex;
uniform mat4 projMat;
uniform float screenWidth;
void main() {
	vec3 pos = texture2D(posTex, vertex).xyz;
	gl_Position = projMat * vec4(pos, 1.);
	gl_PointSize = .05 / gl_Position.w * screenWidth;
}
*/}),
				fragmentPrecision : 'best',
				fragmentCode : mlstr(function(){/*
uniform sampler2D shotTex;
void main() {
	gl_FragColor = texture2D(shotTex, gl_PointCoord) * vec4(0., 1., 1., 1.);
}
*/})
			});
			gl.useProgram(this.drawShader.obj);
			gl.uniform1i(this.drawShader.uniforms.posTex.loc, 0);
			gl.uniform1i(this.drawShader.uniforms.shotTex.loc, 1);
		
			gl.useProgram(null);

			this.addCoordX = 0;
			this.addCoordY = 0;
		},

		reset : function() {
			var initialDataF32 = new Float32Array(this.texSize * this.texSize * 4);
			for (var i = 0; i < this.texSize * this.texSize * 4; ++i) {
				initialDataF32[i] = Infinity;
			}
		
			gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, initialDataF32);
			gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, initialDataF32);
			gl.bindTexture(gl.TEXTURE_2D, this.accelTex.obj);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, initialDataF32);
			gl.bindTexture(gl.TEXTURE_2D, null);
		},
		
		update : function(dt) {
			gl.disable(gl.DEPTH_TEST);
			gl.disable(gl.BLEND);
			gl.disable(gl.CULL_FACE);
			gl.viewport(0, 0, this.texSize, this.texSize);
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.obj);
		
			//update shot position
		
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.float4ScratchTex.obj, 0);
			this.fbo.check();
	
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);

			gl.useProgram(this.updatePosShader.obj);
			gl.uniform1f(this.updatePosShader.uniforms.dt.loc, dt);
			if (game.player !== undefined) {
				gl.uniform3fv(this.updatePosShader.uniforms.playerPos.loc, game.player.pos);
			}

			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
			gl.enableVertexAttribArray(this.updatePosShader.attrs.vertex.loc);
			gl.vertexAttribPointer(this.updatePosShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
			gl.enableVertexAttribArray(this.updatePosShader.attrs.texCoord.loc);
			gl.vertexAttribPointer(this.updatePosShader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			{
				var tmp = this.posTex;
				this.posTex = this.float4ScratchTex;
				this.float4ScratchTex = tmp;
			}

			//update shot velocity 

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.float4ScratchTex.obj, 0);
			this.fbo.check();

			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, this.accelTex.obj);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);

			gl.useProgram(this.updateVelShader.obj);
			gl.uniform1f(this.updateVelShader.uniforms.dt.loc, dt);		
			
			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
			gl.enableVertexAttribArray(this.updateVelShader.attrs.vertex.loc);
			gl.vertexAttribPointer(this.updateVelShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
			gl.enableVertexAttribArray(this.updateVelShader.attrs.texCoord.loc);
			gl.vertexAttribPointer(this.updateVelShader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			{
				var tmp = this.velTex;
				this.velTex = this.float4ScratchTex;
				this.float4ScratchTex = tmp;
			}

			//done with texunit1
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, null);
			
			//now reduce to find if a collision occurred
			//TODO how to do this for all ships, and not just the player?
			// -- how about a low limit on the # of total ships, then just static unrolled for-loop in the shader?

			gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);
			
			//first shader reads from alpha channel
			var shader = this.collisionReduceFirstShader;

			var size = this.texSize;
			while (size > 1) {
				size /= 2;
				if (size !== Math.floor(size)) throw 'got a npo2 size '+this.nx;
				gl.viewport(0, 0, size, size);
			
				//bind scratch texture to fbo
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.float4ScratchTex.obj, 0);
				this.fbo.check();
			
				//setup shader
				gl.useProgram(shader.obj);
				gl.uniform2f(shader.uniforms.texsize.loc, this.texSize, this.texSize);
				gl.uniform2f(shader.uniforms.viewsize.loc, size, size);

				//draw screen quad
				gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
				gl.enableVertexAttribArray(shader.attrs.vertex.loc);
				gl.vertexAttribPointer(shader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
				gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
				gl.enableVertexAttribArray(shader.attrs.texCoord.loc);
				gl.vertexAttribPointer(shader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

				//swap current reduce texture and reduce fbo target tex
				{
					var tmp = this.float4ScratchTex;
					this.float4ScratchTex = this.reduceTex;
					this.reduceTex = tmp;
				}

				shader = this.collisionReduceShader;

				//bind the last used tex (the reduceTex) to the current input of the next reduction
				gl.bindTexture(gl.TEXTURE_2D, this.reduceTex.obj);
			}
			
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.byte4ScratchTex.obj, 0);
			this.fbo.check();
			gl.viewport(0, 0, this.texSize, this.texSize);
			
			gl.useProgram(encodeShader.obj);
			gl.bindTexture(gl.TEXTURE_2D, this.reduceTex.obj);

			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.vertex.obj);
			gl.enableVertexAttribArray(encodeShader.attrs.vertex.loc);
			gl.vertexAttribPointer(encodeShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.quadObj.attrs.texCoord.obj);
			gl.enableVertexAttribArray(encodeShader.attrs.texCoord.loc);
			gl.vertexAttribPointer(encodeShader.attrs.texCoord.loc, 2, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			var uint8Result = new Uint8Array(4);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, uint8Result);

			gl.bindFramebuffer(gl.FRAMEBUFFER, null);

			var float32Result = new Float32Array(uint8Result.buffer);
			gl.viewport(0, 0, this.nx, this.nx);
			var result = float32Result[0];

			if (result > 0) {
				if (game.player !== undefined) {
					game.player.takeDamage(result, undefined, undefined);
				}
			}

			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.viewport(0, 0, glutil.canvas.width, glutil.canvas.height);
			
			gl.enable(gl.DEPTH_TEST);
			gl.enable(gl.BLEND);
			gl.enable(gl.CULL_FACE);
	
			gl.useProgram(defaultShader.obj);
		},

		add : function(damage, newShotPos, newShotVel, newShotAccel) {
			//writing a single pixel
			// which is faster?  fbo with a 1-pixel viewport, or texsubimage of 1 pixel?
			gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, this.addCoordX, this.addCoordY, 1, 1, gl.RGBA, gl.FLOAT, vec4.fromValues(newShotPos[0], newShotPos[1], newShotPos[2], 0));
			gl.bindTexture(gl.TEXTURE_2D, this.velTex.obj);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, this.addCoordX, this.addCoordY, 1, 1, gl.RGBA, gl.FLOAT, vec4.fromValues(newShotVel[0], newShotVel[1], newShotVel[2], damage));
			gl.bindTexture(gl.TEXTURE_2D, this.accelTex.obj);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, this.addCoordX, this.addCoordY, 1, 1, gl.RGBA, gl.FLOAT, vec4.fromValues.apply(vec4, newShotAccel));
			gl.bindTexture(gl.TEXTURE_2D, null);

			//increment pointer in the framebuffer
			++this.addCoordX;
			if (this.addCoordX < this.texSize) return;
			this.addCoordX = 0;
			++this.addCoordY;
			if (this.addCoordY < this.texSize) return;
			this.addCoordY = 0;
		},

		draw : function() {
			//bind the texcoord buffer, use the draw shader to override the vertex data with the position texture data
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
			gl.disable(gl.DEPTH_TEST);
			
			gl.useProgram(this.drawShader.obj);

			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, this.shotTex.obj);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.posTex.obj);
			
			gl.uniformMatrix4fv(this.drawShader.uniforms.projMat.loc, false, glutil.scene.projMat);
			gl.uniform1f(this.drawShader.uniforms.screenWidth.loc, glutil.canvas.width);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
			gl.enableVertexAttribArray(this.drawShader.attrs.vertex.loc);
			gl.vertexAttribPointer(this.drawShader.attrs.vertex.loc, 2, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.POINTS, 0, this.texSize * this.texSize);
			
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, null);
			
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.enable(gl.DEPTH_TEST);
		}
	});

	/*var*/ shotSystem = new ShotSystem();

	var drawQuad = function(pos, color, scale) {
		if (quadIndex >= maxQuads) return;
		scale *= .5;
		var g = quadIndex * 6 * 7;
	
		//vertices
		//colors
		
		quadVertexArray[g++] = pos[0] - scale;
		quadVertexArray[g++] = pos[1] - scale;
		quadVertexArray[g++] = pos[2];
		quadVertexArray[g++] = color[0];
		quadVertexArray[g++] = color[1];
		quadVertexArray[g++] = color[2];
		quadVertexArray[g++] = color[3];
		
		quadVertexArray[g++] = pos[0] + scale;
		quadVertexArray[g++] = pos[1] - scale;
		quadVertexArray[g++] = pos[2];
		quadVertexArray[g++] = color[0];
		quadVertexArray[g++] = color[1];
		quadVertexArray[g++] = color[2];
		quadVertexArray[g++] = color[3];
		
		quadVertexArray[g++] = pos[0] + scale;
		quadVertexArray[g++] = pos[1] + scale;
		quadVertexArray[g++] = pos[2];
		quadVertexArray[g++] = color[0];
		quadVertexArray[g++] = color[1];
		quadVertexArray[g++] = color[2];
		quadVertexArray[g++] = color[3];
		
		quadVertexArray[g++] = pos[0] + scale;
		quadVertexArray[g++] = pos[1] + scale;
		quadVertexArray[g++] = pos[2];
		quadVertexArray[g++] = color[0];
		quadVertexArray[g++] = color[1];
		quadVertexArray[g++] = color[2];
		quadVertexArray[g++] = color[3];
		
		quadVertexArray[g++] = pos[0] - scale;
		quadVertexArray[g++] = pos[1] + scale;
		quadVertexArray[g++] = pos[2];
		quadVertexArray[g++] = color[0];
		quadVertexArray[g++] = color[1];
		quadVertexArray[g++] = color[2];
		quadVertexArray[g++] = color[3];
		
		quadVertexArray[g++] = pos[0] - scale;
		quadVertexArray[g++] = pos[1] - scale;
		quadVertexArray[g++] = pos[2];
		quadVertexArray[g++] = color[0];
		quadVertexArray[g++] = color[1];
		quadVertexArray[g++] = color[2];
		quadVertexArray[g++] = color[3];

		
		++quadIndex;
	};
		
	//game
	
	var Player;
	var Enemy;
	var GroupEnemy;
	var TurretEnemy;
	var Star;

	var Game = makeClass({
		maxStars : 100,
		init : function() {
			this.reset();
		},
		//call after init and assignment of 'game' global
		start : function() {
			for (var i = 0; i < this.maxStars; ++i) {
				new Star();	//auto adds to game.stars
			}
			this.player = new Player({
				pos : vec3.fromValues(0,0,-5)
			});
		},
		reset : function() {
			this.objs = [];
			this.stars = [];	//update separately to not clog up the touch tests
			this.time = 0;
			this.nextEnemyTime = 3;
		},
		update : function(dt) {
			//update
			for (var i = 0; i < this.objs.length; ++i) {
				this.objs[i].update(dt);
			}
			for (var i = 0; i < this.stars.length; ++i) {
				this.stars[i].update(dt);
			}
			for (var i = this.objs.length-1; i >= 0; --i) {
				if (this.objs[i].remove) {
					this.objs.splice(i, 1);
				}
			}
			
			//game logic: add extra enemies
			if (this.time >= this.nextEnemyTime) {
				this.nextEnemyTime = this.time + 10;
			
				if (true) {	//TurretEnemy
					new TurretEnemy({
						pos : vec3.fromValues(
							rand(worldBounds.min[0] + 2, worldBounds.max[0] - 2),
							worldBounds.min[1],
							worldBounds.min[2] + 1),
						vel : vec3.fromValues(0, 0, 5)
					});
				}

				if (false) {	//GroupEnemy
				
					var theta = Math.random() * Math.PI * 2;
					var vel = vec3.fromValues(Math.cos(theta), Math.sin(theta), 1);
					var groupCenter = vec3.fromValues(
						rand(worldBounds.min[0] + 2, worldBounds.max[0] - 2),
						rand(worldBounds.min[1] + 2, worldBounds.max[1] - 2),
						worldBounds.min[2] + 1);
					var spread = 1.5;
					var waveSize = Math.floor(rand(2,6));
					var group = [];
					for (var i = 0; i < waveSize; ++i) {
						var groupAngle = i / waveSize * Math.PI * 2;
						var enemy = new GroupEnemy({
							group : group,
							pos : vec3.fromValues(
								groupCenter[0] + spread * Math.cos(groupAngle),
								groupCenter[1] + spread * Math.sin(groupAngle),
								groupCenter[2]),
							vel : vel
						});
						group.push(enemy);
					}
					for (var i = 0; i < group.length; ++i) {
						group[i].groupInit();
					}

				}
			}

			this.time += dt;
		},
		draw : function() {
			initDrawFrame();
			for (var i = 0; i < this.stars.length; ++i) {
				this.stars[i].draw();
			}
			for (var i = this.objs.length-1; i >= 0; --i) {
				this.objs[i].draw();
			}
			finishDrawFrame();
		}
	});
	
	/*var*/ worldBounds = {
		min : vec3.fromValues(-10, -10, -50),
		max : vec3.fromValues(10, 10, -4)
	};

	Star = makeClass({
		starfieldVelocity : 200,
		color : vec4.fromValues(1,1,1,1),
		scale : 1,
		zMin : worldBounds.min[2] * 10,
		zMax : worldBounds.max[2] + 10,
		init : function() {
			this.pos = vec3.create();
			this.resetXY();
			this.pos[2] = rand(this.zMin, this.zMax);
			game.stars.push(this);
		},
		resetXY : function() {
			var angle = Math.random() * Math.PI * 2;
			var maxBounds = Math.max(worldBounds.max[0], worldBounds.max[1]);
			var r = rand(maxBounds * 10, maxBounds * 30);
			this.pos[0] = Math.cos(angle) * r;
			this.pos[1] = Math.sin(angle) * r;
		},
		update : function(dt) {
			this.pos[2] += dt * this.starfieldVelocity;
			if (this.pos[2] > this.zMax) {
				this.pos[2] -= this.zMax - this.zMin;
				this.resetXY();
			}
		},
		draw : function() {
			drawQuad(this.pos, this.color, this.scale);
		}
	});
	
	var mightTouchObj = [];
	var mightTouchFrac = [];
	var mightTouchLength = 0;
	var GameObject = makeClass({
		color : vec4.fromValues(1,1,1,1),
		scale : 1,
		init : function(args) {
			this.pos = vec3.create();
			this.vel = vec3.create();
			if (args !== undefined) {
				if (args.pos !== undefined) vec3.copy(this.pos, args.pos);
				if (args.vel !== undefined) vec3.copy(this.vel, args.vel);
				if (args.color !== undefined) this.color = vec4.clone(args.color);
			}
			game.objs.push(this);
		},
		update : function(dt) {
			//trace movement
			var startX = this.pos[0];
			var startY = this.pos[1];
			var startZ = this.pos[2];
		
			var deltaX = this.vel[0] * dt;
			var deltaY = this.vel[1] * dt;
			var deltaZ = this.vel[2] * dt;

			var destX = startX + deltaX;
			var destY = startY + deltaY;
			var destZ = startZ + deltaZ;

			if (this.touch) {
				mightTouchLength = 0;
				for (var i = 0; i < game.objs.length; ++i) {
					var o = game.objs[i];
					if (o.remove) continue;
					if (o == this) continue;
					
					//for now assume we're quads ...
					var frac = (o.pos[2] - startZ) / deltaZ;
					if (frac < 0 || frac > 1) continue;

					var x = startX + frac * deltaX;
					var y = startY + frac * deltaY;
					var dx = x - o.pos[0];
					var dy = y - o.pos[1];
					if (Math.abs(dx) < (this.scale + o.scale) * .5 &&
						Math.abs(dy) < (this.scale + o.scale) * .5)
					{
						mightTouchObj[mightTouchLength] = o;
						mightTouchFrac[mightTouchLength] = frac;
						++mightTouchLength;
					}
				}
				//got all objects in our collision hull
				//sort by fraction and check touch with each
				if (mightTouchLength > 0) {
					//small arrays, bubble sort has faster time
					//that and I am sorting two arrays at once, so to use js sort i would merge them into one array
					var swapped;
					do {
						swapped = false;
						for (var i = 1; i < mightTouchLength; ++i) {
							if (mightTouchFrac[i-1] > mightTouchFrac[i]) {
								var tmp;
								tmp = mightTouchFrac[i-1];
								mightTouchFrac[i-1] = mightTouchFrac[i];
								mightTouchFrac[i] = tmp;
								tmp = mightTouchObj[i-1];
								mightTouchObj[i-1] = mightTouchObj[i];
								mightTouchObj[i] = tmp;
								swapped = true;
							}
						}
					} while (swapped);
					//mightTouch.sort(function(a,b) { return a.frac - b.frac; });
					
					for (var i = 0; i < mightTouchLength; ++i) {
						var o = mightTouchObj[i];
						var f = mightTouchFrac[i];
						this.pos[0] = startX + deltaX * f;
						this.pos[1] = startY + deltaY * f;
						this.pos[2] = startZ + deltaZ * f;
						var stopped = this.touch(o);
						if (this.remove) return;
						if (stopped) {
							destX = this.pos[0];
							destY = this.pos[1];
							destZ = this.pos[2];
							break;
						}
					}
				}
			}

			this.pos[0] = destX;
			this.pos[1] = destY;
			this.pos[2] = destZ;
			
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
			drawQuad(this.pos, this.color, this.scale);
		}
	});
	
	var Shot = makeClass({
		super : GameObject,
		color : vec4.fromValues(0,1,1,1),
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
			if (other == this.owner) return false;
			if (!other.takeDamage) return false;	//return other.collides;  so objects can block shots even if they're not taking damage
			other.takeDamage(this.damage, this, this.owner);
			this.remove = true;
			return true;
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
			this.scale = rand(.25, .75) * rand(.25, .75);
			vec3.scale(this.vel, this.vel, 2 / (this.scale * vec3.length(this.vel)));	//smaller chunks go further
		},
		update : function(dt) {
			Shrapnel.superProto.update.apply(this, arguments);
			this.life -= dt;
			if (this.life < 0) this.remove = true;
		}
	});

	var BasicShotWeapon = makeClass({
		reloadTime : .1,
		init : function(args) {
			this.nextShotTime = 0;
			if (args !== undefined) {
				if (args.owner !== undefined) this.owner = args.owner;
			}
		},
		shoot : function(vx, vy, vz, ax, ay, az) {
			if (game.time < this.nextShotTime) return;
			this.nextShotTime = game.time + this.reloadTime;	//reload time
			
			if (this.owner == game.player) {
				//create shots for the player
				new Shot({
					owner : this.owner,
					vel : vec3.fromValues(vx, vy, vz)
					//TODO accel support for player shots
				});
			} else {
				shotSystem.add(
					Shot.prototype.damage,
					this.owner.pos,
					vec3.fromValues(vx, vy, vz),
					vec3.fromValues(ax, ay, az));
			}
		},

	});

	var Ship = makeClass({
		super : GameObject,
		removeWhenOOB : true,
		maxHealth : 1,
		init : function(args) {
			Ship.super.apply(this, arguments);
			this.health = this.maxHealth;
			if (args !== undefined) {
				if (args.health !== undefined) this.health = args.health;
			}
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

	Enemy = makeClass({
		super : Ship
	});

	TurretEnemy = makeClass({
		super : Enemy,
		color : vec4.fromValues(1,0,0,1),
		nextShotTime : 0,
		update : function() {
			TurretEnemy.superProto.update.apply(this, arguments);
			
			
			//can shoot again
			if (game.time > this.nextShotTime) {
				this.nextShotTime = game.time + 3;

				var speed = 10;

				//fire off a few shots
				var dx = 0;
				var dy = 0;
				var dz = 1;

				if (game.player !== undefined) {
					dx = game.player.pos[0] - this.pos[0];
					dy = game.player.pos[1] - this.pos[1];
					dz = game.player.pos[2] - this.pos[2];
					var s = 1/Math.sqrt(dx * dx + dy * dy + dz * dz);
					dx *= s;
					dy *= s;
					dz *= s;
				}

				//x axis
				var ax = 1;
				var ay = 0;
				var az = 0;

				//d cross x
				var bx = 0;
				var by = dz;
				var bz = -dy;

				var iMaxRadius = 5;
				for (var iradius = 0; iradius < iMaxRadius; ++iradius) {
					var iMaxTheta = iradius * iradius + 1;
					var radius = iradius / iMaxRadius;
					for (var itheta = 0; itheta < iMaxTheta; ++itheta) {
						var theta = (itheta + .5) / iMaxTheta * Math.PI * 2;
						var u = Math.cos(theta) * radius;
						var v = Math.sin(theta) * radius;
						shotSystem.add(
							Shot.prototype.damage,
							vec3.fromValues(
								this.pos[0] + ax * u + bx * v,
								this.pos[1] + ay * u + by * v,
								this.pos[2] + az * u + bz * v),
							vec3.fromValues(dx * speed, dy * speed, dz * speed),
							vec3.create());
					}
				}
			}
		}
	});

	GroupEnemy = makeClass({
		super : Enemy,
		color : vec4.fromValues(1,0,1,1),
		init : function(args) {
			GroupEnemy.super.apply(this, arguments);
			if (args !== undefined) {
				if (args.group !== undefined) this.group = args.group;
			}
			this.weapon = new BasicShotWeapon({
				owner : this
			});	
		},
		groupInit : function() {
			if (this.group !== undefined) {
				this.groupCenter = vec3.create();
				this.updateGroupCenter();
				var deltaX = this.pos[0] - this.groupCenter[0];
				var deltaY = this.pos[1] - this.groupCenter[1];
				this.vel[0] += -deltaY;
				this.vel[1] += deltaX;
			}
		},
		updateGroupCenter : function() {
			this.groupCenter[0] = 0;
			this.groupCenter[1] = 0;
			this.groupCenter[2] = 0;
			for (var i = 0; i < this.group.length; ++i) {
				vec3.add(this.groupCenter, this.groupCenter, this.group[i].pos);
			}
			vec3.scale(this.groupCenter, this.groupCenter, 1/this.group.length);
		},
		update : function(dt) {
			GroupEnemy.superProto.update.apply(this, arguments);
		
			/* a few acceleration tricks ...
			
			intersect with player:
			pi = initial shot position
			vi = initial shot velocity
			a = shot acceleration

			pf = final shot position = player position
			vf = final shot velocity

			px = pxi + vxi * t + 1/2 ax * t^2
			py = pyi + vyi * t + 1/2 ay * t^2
			pz = pzi + vzi * t + 1/2 az * t^2

			1/2 az t^2 + vzi t + pzi - pzf = 0
			t = [-vzi +- sqrt(vzi^2 - az*(pzi-pzf)]/(az)
			except when az = 0 we get
			pzf = pzi + vzi * t	<- time to final z position
			t = (pzf - pzi) / vzi

			pxf = pxi + vxi * t + 1/2 axi * t^2
			1/2 axi * t^2 = pxf - pxi - vxi * t
			axi = 2 * (pxf - pxi) / t^2 - 2 * vxi / t
			*/
			var vz = 15;
			var vx = 0;
			var vy = 0;

			var ax = 0;
			var ay = 0;
			var az = 0;
			/*homing
			if (game.player !== undefined) {
				var t = (game.player.pos[2] - this.pos[2]) / vz;
				ax = 2 * ((game.player.pos[0] - this.pos[0]) / t - vx) / t;
				ay = 2 * ((game.player.pos[1] - this.pos[1]) / t - vy) / t;
			}
			*/
			this.weapon.shoot(vx, vy, vz, ax, ay, 0);
			
			if (this.group !== undefined && this.group.length > 1) {
				// do some cool BOIDs routine
				this.updateGroupCenter();
				//now ... spin around it!
				var deltaX = this.groupCenter[0] - this.pos[0];
				var deltaY = this.groupCenter[1] - this.pos[1];
				var deltaZ = this.groupCenter[2] - this.pos[2];
				this.vel[0] += deltaX * .1;
				this.vel[1] += deltaY * .1;
				this.vel[2] += deltaZ * .1;
			}
		},
		die : function() {
			GroupEnemy.superProto.die.apply(this, arguments);
			if (this.group !== undefined) {
				this.group.remove(this);
			}
		}
	});

	var Player = makeClass({
		super : Ship,
		color : vec4.fromValues(1,1,0,.75),
		maxHealth : 20,
		removeWhenOOB : false,
		init : function() {
			Player.super.apply(this, arguments);
			this.targetPos = vec3.create();
			this.aimPos = vec3.create();
			this.aimPos[2] = worldBounds.min[2];
			this.speed = 10;
			this.weapon = new BasicShotWeapon({
				owner : this
			});
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
				var velX = this.aimPos[0] - this.pos[0];
				var velY = this.aimPos[1] - this.pos[1];
				var velZ = this.aimPos[2] - this.pos[2];
				var speed = 20;
				var scalar = speed / Math.sqrt(velX*velX + velY*velY + velZ*velZ);
				this.weapon.shoot(velX*scalar, velY*scalar, velZ*scalar, 0,0,0);
			}
		},
		takeDamage : function(damage, inflicter, attacker) {
			Player.superProto.takeDamage.apply(this, arguments);
			console.log('hit and at',this.health);
		},
		die : function(inflicter, attacker) {
			//add lots of explosion bits 
			var r = Math.random();
			var g = Math.random() * r;
			var b = Math.random() * g;
			for (var i = 0; i < 20; ++i) {
				new Shrapnel({
					pos : this.pos,
					color : vec4.fromValues(r,g,b,1)
				});
			}
			
			Player.superProto.die.apply(this, arguments);
			game.player = undefined;
			//restart the game
			setTimeout(function() {
				//I was just creating a new game, but Chrome leaked badly and the framerate of the subsequent games got kicked down a big percent each time. 
				game.reset();
				shotSystem.reset();
				game.start();
			}, 5000);
		}
	});
	
	/*var*/ game = new Game();
	game.start();
	shotSystem.reset();

	//update loop
	var update = function() {
		//
		var dt = 1/30;

		shotSystem.update(dt);

		//update game objects
		game.update(dt);
		
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		shotSystem.draw();
		game.draw();
		
		//test
		//the renderr goes very fast.  20k quads at 60fps only because it was vsync'd
		//the slowdown is from the game update
		/*
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		initDrawFrame();
		for (var i = 0; i < maxQuads; ++i) {
			drawQuad(
				[rand(-5,5), rand(-5,5), rand(-50,-5)], 
				[Math.random(), Math.random(), Math.random(), Math.random()],
				1);
		}
		finishDrawFrame();
		*/

		requestAnimFrame(update);
	};
	update();

	//mouse input
	var movePlayer = function(xf, yf) {
		if (game.player === undefined) return;
		var aspectRatio = glutil.canvas.width / glutil.canvas.height;
		var targetScale = -game.player.pos[2];
		game.player.targetPos[0] = (xf * 2 - 1) * aspectRatio * targetScale;
		game.player.targetPos[1] = (1 - yf * 2) * targetScale;
		game.player.aimPos[0] = game.player.targetPos[0];
		game.player.aimPos[1] = game.player.targetPos[0];
	};
	var aimPlayer = function(xf, yf) {
		if (game.player === undefined) return;
		var aspectRatio = glutil.canvas.width / glutil.canvas.height;
		var targetScale = -game.player.pos[2];
		game.player.aimPos[0] = (xf * 2 - 1) * aspectRatio * targetScale;
		game.player.aimPos[1] = (1 - yf * 2) * targetScale;
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
		if (game.player !== undefined) game.player.shooting = true;
	});
	$(window).bind('mouseup', function(e) {
		if (game.player !== undefined) game.player.shooting = false;
	});
	$(window).bind('touchmove', function(e) {
		handleInputEvent(e.originalEvent.changedTouches[0]);
	});
	$(window).bind('touchstart', function(e) {
		if (game.player !== undefined) game.player.shooting = true;
	});
	$(window).bind('touchend touchcancel', function(e) {
		if (game.player !== undefined) game.player.shooting = false;
	});
});

