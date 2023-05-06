/**
 * WikiEdit is a tool for quickly editing content without leaving the page.
 *
 * Documentation: https://www.mediawiki.org/wiki/WikiEdit
 * License: GNU General Public License 3 or later (http://www.gnu.org/licenses/gpl-3.0.html)
 * Author: Felipe Schenone (User:Sophivorus)
 */
window.WikiEdit = {

	elements: 'p, li, dd, td',

	init: function () {

		// Only init when viewing
		var action = mw.config.get( 'wgAction' );
		if ( action !== 'view' ) {
			return;
		}

		// Only init in useful namespaces
		// See https://www.mediawiki.org/wiki/Manual:Namespace_constants
		var namespaces = [ 0, 2, 4, 12, 14 ];
		var namespace = mw.config.get( 'wgNamespaceNumber' );
		var talk = namespace % 2; // Talk pages always have odd namespaces
		if ( !namespaces.includes( namespace ) && !talk ) {
			return;
		}

		// Only init in wikitext pages
		var model = mw.config.get( 'wgPageContentModel' );
		if ( model !== 'wikitext' ) {
			return;
		}

		WikiEdit.addEditButtons();
	},

	/**
	 * Add the edit buttons to the elements that are likely to be editable
	 */
	addEditButtons: function () {
		var $elements = $( WikiEdit.elements, '#mw-content-text' );

		// Filter elements with no text node
		// @todo Make more efficient
		$elements = $elements.filter( function () {
			var $element = $( this );
			return WikiEdit.getLongestText( $element );
		} );

		// The behavior of the buttons is different in Minerva
		// because on mobile devices there's no hover event
		if ( mw.config.get( 'skin' ) === 'minerva' ) {
			$elements.each( WikiEdit.addEditButton );
			$elements.each( WikiEdit.showEditButton );
		} else {
			$elements.each( WikiEdit.addEditButton );
			$elements.on( 'mouseenter', WikiEdit.showEditButton );
			$elements.on( 'mouseleave', WikiEdit.hideEditButton );
		}
	},

	showEditButton: function () {
		$( this ).find( '.wikiedit-button' ).first().show();
	},

	hideEditButton: function () {
		$( this ).find( '.wikiedit-button' ).first().hide();
	},

	/**
	 * Add edit button
	 */
	addEditButton: function () {
		var $element = $( this );

		// Make the button
		var path = '<path fill="currentColor" d="M16.77 8l1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zm-5.81-3.71L1 14.25V19h4.75l9.96-9.96-4.75-4.75z"></path>';
		var icon = '<svg width="14" height="14" viewBox="0 0 20 20">' + path + '</svg>';
		var $button = $( '<span hidden class="wikiedit-button noprint">' + icon + '</span>' );
		$button.on( 'click', WikiEdit.addEditForm );

		// Add a little CSS from here to delay loading the full CSS until the user actually clicks
		$button.css( { 'color': '#a2a9b1', 'cursor': 'pointer' } );
		$button.on( 'mouseenter', function () { $( this ).css( 'color', '#202122' ); } );
		$button.on( 'mouseleave', function () { $( this ).css( 'color', '#a2a9b1' ); } );

		// Add to the DOM
		if ( $element.children( 'ul, ol, dl' ).length ) {
			$element.children( 'ul, ol, dl' ).before( ' ', $button );
		} else {
			$element.append( ' ', $button );
		}
	},

	/**
	 * Add edit form
	 */
	addEditForm: function ( event ) {
		var $button = $( event.target );
		var $element = $button.closest( WikiEdit.elements );

		// Load the page wikitext the first time this method is called
		if ( !WikiEdit.pageWikitext ) {
			WikiEdit.loadPageWikitext().done( function () {
				WikiEdit.addEditForm( event );
			} );
			return;
		}

		// If no relevant wikitext is found, fallback to regular edit
		var wikitext = WikiEdit.getRelevantWikitext( $element );
		if ( !wikitext ) {
			var $section = WikiEdit.getSection( $element );
			var sectionNumber = $section ? 1 + $section.prevAll( ':header' ).length : 0;
			var edit = mw.util.getUrl( null, {
				action: 'edit',
				section: sectionNumber
			} );
			window.location.href = edit;
			return;
		}

		// Load the necessary CSS and messages the first time we reach this point
		if ( !WikiEdit.loadedCSS ) {
			WikiEdit.loadCSS().done( function () {
				WikiEdit.addEditForm( event );
			} );
			return;
		}
		if ( !WikiEdit.loadedMessages ) {
			WikiEdit.loadMessages().done( function () {
				WikiEdit.addEditForm( event );
			} );
			return;
		}

		// Make the form
		var save = mw.message( 'wikiedit-form-save' ).text();
		var cancel = mw.message( 'wikiedit-form-cancel' ).text();
		var $form = $( '<div class="wikiedit-form"></div>' );
		var $input = $( '<div class="wikiedit-form-input" contenteditable="true"></div>' ).text( wikitext );
		var $footer = $( '<div class="wikiedit-form-footer"></div>' );
		var $submit = $( '<button class="wikiedit-form-submit mw-ui-button mw-ui-progressive">' + save + '</button>' );
		var $cancel = $( '<button class="wikiedit-form-cancel mw-ui-button">' + cancel + '</button>' );
		$footer.append( $submit, $cancel );
		$form.append( $input, $footer );

		// Add to the DOM
		var $original = $element.clone( true ); // Save it for later
		$element.html( $form );
		$input.focus();

		// Handle the submit
		$submit.on( 'click', {
			'element': $element,
			'original': $original,
			'wikitext': wikitext
		}, WikiEdit.onSubmit );

		// Handle the cancel
		$cancel.on( 'click', function () {
			$element.replaceWith( $original );
		} );
	},

	onSubmit: function ( event ) {
		var $submit = $( this );
		var $footer = $submit.closest( '.wikiedit-form-footer' );
		var $form = $submit.closest( '.wikiedit-form' );
		$footer.text( 'Saving...' );
		var $element = event.data.element;
		var oldWikitext = event.data.wikitext;
		var newWikitext = $form.find( '.wikiedit-form-input' ).prop( 'innerText' ); // jQuery's text() removes line breaks
		if ( oldWikitext === newWikitext ) {
			var $original = event.data.original;
			$element.replaceWith( $original );
			return;
		}

		WikiEdit.pageWikitext = WikiEdit.pageWikitext.replace( oldWikitext, newWikitext );
		var params = {
			'action': 'edit',
			'title': mw.config.get( 'wgPageName' ),
			'text': WikiEdit.pageWikitext,
			'summary': WikiEdit.makeSummary( newWikitext, $element ),
			'tags': 'wikiedit',
		};
		new mw.Api().postWithEditToken( params ).done( function () {
			WikiEdit.onSuccess( $element, newWikitext );
		} );
	},

	onSuccess: function ( $element, newWikitext ) {
		var params = {
			'action': 'parse',
			'title': mw.config.get( 'wgPageName' ),
			'text': newWikitext,
			'formatversion': 2,
			'prop': 'text',
			'wrapoutputclass': null,
			'disablelimitreport': true,
		};
		new mw.Api().get( params ).done( function ( data ) {
			var text = data.parse.text;
			var html = $( text ).html();
			$element.html( html );
		} );
	},

	/**
	 * Load the wikitext of the current page
	 */
	pageWikitext: '', // Will hold the wikitext
	loadPageWikitext: function () {
		var params = {
			'page': mw.config.get( 'wgPageName' ),
			'action': 'parse',
			'prop': 'wikitext',
			'formatversion': 2,
		};
		return new mw.Api().get( params ).done( function ( data ) {
			var pageWikitext = data.parse.wikitext;
			WikiEdit.pageWikitext = pageWikitext;
		} );
	},

	/**
	 * Load interface messages directly from the Wikimedia repository 
	 */
	loadedMessages: false, // Tracking flag
	loadMessages: function () {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/i18n/en.json?format=text', function ( data ) {
			var json = WikiEdit.decodeBase64( data );
			var messages = JSON.parse( json );
			delete messages[ '@metadata' ];
			mw.messages.set( messages );
			WikiEdit.loadedMessages = true;
		} );
	},

	/**
	 * Load CSS directly from the Wikimedia repository and add it to the DOM
	 */
	loadedCSS: false, // Tracking flag
	loadCSS: function () {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/WikiEdit/+/master/wikiedit.css?format=text', function ( data ) {
			var css = atob( data );
			var $style = $( '<style>' ).html( css );
			$( 'head' ).append( $style );
			WikiEdit.loadedCSS = true;
		} );
	},

	/**
	 * Helper method to get the relevant wikitext that corresponds to a given DOM element
	 *
	 * This is the heart of the tool
	 * It's an heuristic method to try to find the relevant wikitext
	 * that corresponds to the DOM element being edited
	 * Since wikitext and HTML are different markups
	 * the only place where they meet is in plain text
	 * so we find the longest fragment of plain text in the HTML
	 * and from there we figure out the boundaries of the relevant wikitext
	 *
	 * @param {jQuery object} jQuery object representing the DOM element being edited
	 * @return {string|null} Wikitext of the element being edited, or null if it can't be found
	 */
	getRelevantWikitext: function ( $element ) {
		var wikitext;

		// Get the text of longest text node
		// because it has the most chances of being unique
		var text = WikiEdit.getLongestText( $element );

		// Some elements don't have text nodes
		// for example list items with just a link
		if ( !text ) {
			return;
		}

		// Match all lines that contain the text
		text = text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
		var regexp = new RegExp( '.*' + text + '.*', 'g' );
		var matches = WikiEdit.pageWikitext.match( regexp );

		// This happens often when the element comes from a template
		if ( !matches ) {
			return;
		}

		// This happens often when the text is very short and accidentally repeats
		if ( matches.length > 1 ) {
			return;
		}

		// If we reach this point, we got our relevant wikitext
		// However, we'll try to clean it up a little
		wikitext = matches[0];

		// Clean up list items
		wikitext = wikitext.replace( /^[*#:]+ */, '' );

		// Clean up template parameters
		wikitext = wikitext.replace( /^\|.*= */, '' );

		// Clean up table captions
		wikitext = wikitext.replace( /^\|\+ */, '' );

		// Clean up table headers
		wikitext = wikitext.replace( /^! */, '' );

		// Clean up table cells and anonymous template parameters
		wikitext = wikitext.replace( /^\| */, '' );

		// In theory this should not happen
		if ( !wikitext ) {
			return;
		}

		// We're done, return the relevant wikitext
		return wikitext;
	},

	/**
	 * Helper method to get the text of the longest text node
	 */
	getLongestText: function ( $element ) {
		var text = '';
		var $textNodes = $element.contents().filter( function () {
			return this.nodeType === Node.TEXT_NODE;
		} );
		$textNodes.each( function () {
			var nodeText = $( this ).text().trim();
			if ( nodeText.length > text.length ) {
				text = nodeText;
			}
		} );
		return text;
	},

	/**
	 * Helper method to build a helpful edit summary
	 */
	makeSummary: function ( wikitext, $element ) {
		var action = 'edit';
		if ( !wikitext ) {
			action = 'delete';
		}
		var link = 'mw:WikiEdit';
		if ( mw.config.get( 'wikiedit-link' ) ) {
			link = mw.config.get( 'wikiedit-link' );
		}
		var summary = mw.message( 'wikiedit-summary-' + action, link ).text();
		var $section = WikiEdit.getSection( $element );
		if ( $section ) {
			var sectionText = $section.find( '.mw-headline' ).text();
			summary = '/* ' + sectionText + ' */ ' + summary;
		}
		return summary;
	},

	/**
	 * Helper method to find the closest section
	 * by traversing back and up the DOM tree
	 *
	 * @param {jQuery object} Starting element
	 * @return {jQuery object} Closest section
	 */
	getSection: function ( $element ) {
		if ( $element.attr( 'id' ) === 'mw-content-text' ) {
			return;
		}
		if ( $element.is( ':header' ) ) {
			return $element;
		}
		var $previous = $element.prevAll( ':header' ).first();
		if ( $previous.length ) {
			return $previous;
		}
		var $parent = $element.parent();
		return WikiEdit.getSection( $parent );
	},

	/**
	 * Helper function to decode base64 strings
	 * See https://stackoverflow.com/questions/30106476
	 *
	 * @param {string} Encoded string
	 * @return {string} Decoded string
	 */
	decodeBase64: function ( string ) {
		return decodeURIComponent( window.atob( string ).split( '' ).map( function ( character ) {
			return '%' + ( '00' + character.charCodeAt( 0 ).toString( 16 ) ).slice( -2 );
		} ).join( '' ) );
	}
};

$.when( mw.loader.using( [
	'mediawiki.api',
	'mediawiki.util'
] ), $.ready ).then( WikiEdit.init );